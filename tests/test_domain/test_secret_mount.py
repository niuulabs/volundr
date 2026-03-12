"""Tests for SecretMountService domain service."""

from __future__ import annotations

import pytest

from volundr.domain.models import MountType, SecretMountSpec
from volundr.domain.services.secret_mount import SecretMountService


@pytest.fixture
def svc() -> SecretMountService:
    """Create a SecretMountService instance."""
    return SecretMountService()


def _mount(
    dest: str,
    path: str = "secret/data",
    mount_type: MountType = MountType.ENV_FILE,
    template: str | None = None,
    renewal: bool = False,
) -> SecretMountSpec:
    """Helper to build a SecretMountSpec."""
    return SecretMountSpec(
        secret_path=path,
        mount_type=mount_type,
        destination=dest,
        template=template,
        renewal=renewal,
    )


class TestMergeMounts:
    """Tests for merge_mounts."""

    def test_empty_lists(self, svc: SecretMountService):
        result = svc.merge_mounts([], [], [])
        assert result == []

    def test_tenant_only(self, svc: SecretMountService):
        tenant = [
            _mount("/etc/env", path="tenants/t1/shared/db"),
        ]
        result = svc.merge_mounts(tenant, [], [])
        assert len(result) == 1
        assert result[0].secret_path == "tenants/t1/shared/db"

    def test_session_overrides_user_overrides_tenant(
        self,
        svc: SecretMountService,
    ):
        dest = "/home/volundr/.env"
        tenant = [_mount(dest, path="tenant-path")]
        user = [_mount(dest, path="user-path")]
        session = [_mount(dest, path="session-path")]

        result = svc.merge_mounts(tenant, user, session)
        assert len(result) == 1
        assert result[0].secret_path == "session-path"

    def test_user_overrides_tenant(
        self,
        svc: SecretMountService,
    ):
        dest = "/run/secrets/api"
        tenant = [_mount(dest, path="tenant-path")]
        user = [_mount(dest, path="user-path")]

        result = svc.merge_mounts(tenant, user, [])
        assert len(result) == 1
        assert result[0].secret_path == "user-path"

    def test_different_destinations_all_kept(
        self,
        svc: SecretMountService,
    ):
        tenant = [_mount("/a", path="p-a")]
        user = [_mount("/b", path="p-b")]
        session = [_mount("/c", path="p-c")]

        result = svc.merge_mounts(tenant, user, session)
        assert len(result) == 3
        dests = {m.destination for m in result}
        assert dests == {"/a", "/b", "/c"}


class TestGenerateVaultAgentConfig:
    """Tests for generate_vault_agent_config."""

    def test_empty_mounts_returns_empty(
        self,
        svc: SecretMountService,
    ):
        result = svc.generate_vault_agent_config(
            "s1",
            "u1",
            [],
        )
        assert result == ""

    def test_produces_valid_config(
        self,
        svc: SecretMountService,
    ):
        mounts = [
            _mount(
                "/home/volundr/.env",
                path="users/u1/keys/api",
                mount_type=MountType.ENV_FILE,
            ),
        ]
        config = svc.generate_vault_agent_config(
            "s1",
            "u1",
            mounts,
        )
        assert "auto_auth" in config
        assert "volundr-session-s1" in config
        assert 'method "kubernetes"' in config

    def test_env_file_template(
        self,
        svc: SecretMountService,
    ):
        mounts = [
            _mount(
                "/home/volundr/.env",
                path="users/u1/keys/api",
                mount_type=MountType.ENV_FILE,
            ),
        ]
        config = svc.generate_vault_agent_config(
            "s1",
            "u1",
            mounts,
        )
        assert "range $k, $v" in config
        assert "/home/volundr/.env" in config

    def test_file_template(self, svc: SecretMountService):
        mounts = [
            _mount(
                "/run/secrets/cert.pem",
                path="certs/tls",
                mount_type=MountType.FILE,
            ),
        ]
        config = svc.generate_vault_agent_config(
            "s1",
            "u1",
            mounts,
        )
        assert ".Data.data.value" in config
        assert "/run/secrets/cert.pem" in config

    def test_custom_template(
        self,
        svc: SecretMountService,
    ):
        custom = "{{ .Data.data.custom_field }}"
        mounts = [
            _mount(
                "/tmp/custom",
                path="secret/custom",
                mount_type=MountType.TEMPLATE,
                template=custom,
            ),
        ]
        config = svc.generate_vault_agent_config(
            "s1",
            "u1",
            mounts,
        )
        assert custom in config

    def test_multiple_mounts(
        self,
        svc: SecretMountService,
    ):
        mounts = [
            _mount("/a", path="p1", mount_type=MountType.ENV_FILE),
            _mount("/b", path="p2", mount_type=MountType.FILE),
        ]
        config = svc.generate_vault_agent_config(
            "s1",
            "u1",
            mounts,
        )
        assert config.count("template {") == 2

    def test_no_renewal_sets_exit_after_true(
        self,
        svc: SecretMountService,
    ):
        mounts = [
            _mount("/a", renewal=False),
        ]
        config = svc.generate_vault_agent_config(
            "s1",
            "u1",
            mounts,
        )
        assert "exit_after_auth = true" in config

    def test_renewal_sets_exit_after_false(
        self,
        svc: SecretMountService,
    ):
        mounts = [
            _mount("/a", renewal=True),
        ]
        config = svc.generate_vault_agent_config(
            "s1",
            "u1",
            mounts,
        )
        assert "exit_after_auth = false" in config


class TestGeneratePodAnnotations:
    """Tests for generate_pod_annotations."""

    def test_returns_correct_annotations(
        self,
        svc: SecretMountService,
    ):
        annotations = svc.generate_pod_annotations(
            "s1",
            has_renewal=False,
        )
        assert annotations["vault.hashicorp.com/agent-inject"] == "true"
        assert annotations["vault.hashicorp.com/role"] == "volundr-session-s1"
        assert annotations["vault.hashicorp.com/agent-pre-populate-only"] == "true"

    def test_renewal_enabled(
        self,
        svc: SecretMountService,
    ):
        annotations = svc.generate_pod_annotations(
            "s2",
            has_renewal=True,
        )
        assert annotations["vault.hashicorp.com/agent-pre-populate-only"] == "false"
