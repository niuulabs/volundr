"""Tests for SecretInjectionPort adapters and PodSpecAdditions model."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from volundr.adapters.outbound.infisical_secret_injection import (
    InfisicalCSISecretInjectionAdapter,
)
from volundr.adapters.outbound.memory_secret_injection import (
    InMemorySecretInjectionAdapter,
)
from volundr.domain.models import PodSpecAdditions

# ------------------------------------------------------------------
# PodSpecAdditions model
# ------------------------------------------------------------------


class TestPodSpecAdditions:
    """Tests for the PodSpecAdditions frozen dataclass."""

    def test_defaults(self):
        pa = PodSpecAdditions()
        assert pa.volumes == ()
        assert pa.volume_mounts == ()
        assert pa.labels == {}
        assert pa.annotations == {}
        assert pa.env == ()
        assert pa.service_account is None

    def test_frozen(self):
        pa = PodSpecAdditions()
        with pytest.raises(AttributeError):
            pa.service_account = "new-sa"  # type: ignore[misc]

    def test_with_values(self):
        pa = PodSpecAdditions(
            volumes=({"name": "v1"},),
            volume_mounts=({"name": "v1", "mountPath": "/mnt"},),
            labels={"app": "test"},
            annotations={"note": "value"},
            env=({"name": "FOO", "value": "bar"},),
            service_account="my-sa",
        )
        assert len(pa.volumes) == 1
        assert pa.volumes[0]["name"] == "v1"
        assert pa.volume_mounts[0]["mountPath"] == "/mnt"
        assert pa.labels == {"app": "test"}
        assert pa.annotations == {"note": "value"}
        assert len(pa.env) == 1
        assert pa.service_account == "my-sa"

    def test_post_init_converts_empty_tuple_defaults_to_dicts(self):
        """Labels and annotations use () as frozen default, converted to {} by __post_init__."""
        pa = PodSpecAdditions()
        assert isinstance(pa.labels, dict)
        assert isinstance(pa.annotations, dict)


# ------------------------------------------------------------------
# InMemorySecretInjectionAdapter
# ------------------------------------------------------------------


class TestInMemorySecretInjectionAdapter:
    """Tests for the in-memory adapter."""

    @pytest.fixture()
    def adapter(self):
        return InMemorySecretInjectionAdapter()

    @pytest.mark.asyncio()
    async def test_pod_spec_additions_returns_empty(self, adapter):
        result = await adapter.pod_spec_additions("user-1", "session-1")
        assert isinstance(result, PodSpecAdditions)
        assert result.volumes == ()
        assert result.service_account is None

    @pytest.mark.asyncio()
    async def test_provision_user(self, adapter):
        await adapter.provision_user("alice")
        assert "alice" in adapter._provisioned_users

    @pytest.mark.asyncio()
    async def test_deprovision_user(self, adapter):
        await adapter.provision_user("alice")
        await adapter.deprovision_user("alice")
        assert "alice" not in adapter._provisioned_users

    @pytest.mark.asyncio()
    async def test_deprovision_nonexistent_is_noop(self, adapter):
        # Should not raise
        await adapter.deprovision_user("nonexistent")

    @pytest.mark.asyncio()
    async def test_accepts_extra_kwargs(self):
        """Dynamic adapter pattern: extra kwargs are ignored."""
        adapter = InMemorySecretInjectionAdapter(foo="bar", baz=42)
        result = await adapter.pod_spec_additions("u1", "s1")
        assert isinstance(result, PodSpecAdditions)


# ------------------------------------------------------------------
# InfisicalCSISecretInjectionAdapter
# ------------------------------------------------------------------


def _mock_response(status_code: int = 200, json_data: dict | None = None) -> httpx.Response:
    """Build a mock httpx.Response."""
    return httpx.Response(
        status_code=status_code,
        json=json_data or {},
        request=httpx.Request("GET", "http://test"),
    )


class TestInfisicalCSISecretInjectionAdapter:
    """Tests for the Infisical CSI adapter with mocked httpx."""

    @pytest.fixture()
    def adapter(self):
        return InfisicalCSISecretInjectionAdapter(
            infisical_url="https://infisical.test",
            client_id="test-client-id",
            client_secret="test-client-secret",
            namespace="test-ns",
        )

    @pytest.mark.asyncio()
    async def test_pod_spec_additions_returns_csi_volume(self, adapter):
        result = await adapter.pod_spec_additions("alice", "s-123")

        assert result.service_account == "skuld-alice"
        assert len(result.volumes) == 1
        vol = result.volumes[0]
        assert vol["csi"]["driver"] == "secrets-store.csi.k8s.io"
        assert vol["csi"]["readOnly"] is True
        assert vol["csi"]["volumeAttributes"]["secretProviderClass"] == "infisical-alice"

        assert len(result.volume_mounts) == 1
        mount = result.volume_mounts[0]
        assert mount["mountPath"] == "/run/secrets/user"
        assert mount["readOnly"] is True

    @pytest.mark.asyncio()
    async def test_provision_user_creates_project_and_identity(self, adapter):
        auth_resp = _mock_response(200, {"accessToken": "tok-123"})
        project_resp = _mock_response(200, {"workspace": {"id": "proj-id-1"}})
        identity_resp = _mock_response(200, {"identity": {"id": "ident-id-1"}})
        k8s_auth_resp = _mock_response(200, {})

        with patch.object(adapter, "_get_client") as mock_client_fn:
            mock_client = AsyncMock()
            mock_client_fn.return_value = mock_client
            mock_client.post = AsyncMock(
                side_effect=[auth_resp, project_resp, identity_resp, k8s_auth_resp]
            )

            await adapter.provision_user("alice")

            # Auth + 3 API calls
            assert mock_client.post.call_count == 4

            # Verify project creation
            project_call = mock_client.post.call_args_list[1]
            assert project_call[0][0] == "/api/v2/workspace"
            assert project_call[1]["json"]["projectName"] == "user-alice"

            # Verify identity creation
            identity_call = mock_client.post.call_args_list[2]
            assert identity_call[0][0] == "/api/v1/identities"
            assert identity_call[1]["json"]["name"] == "skuld-alice"

            # Verify k8s auth
            k8s_call = mock_client.post.call_args_list[3]
            assert "/kubernetes-auth" in k8s_call[0][0]
            assert k8s_call[1]["json"]["allowedServiceAccounts"] == "skuld-alice"
            assert k8s_call[1]["json"]["allowedNamespaces"] == "test-ns"

    @pytest.mark.asyncio()
    async def test_deprovision_user_deletes_identity_and_project(self, adapter):
        auth_resp = _mock_response(200, {"accessToken": "tok-123"})
        delete_identity_resp = _mock_response(200, {})
        delete_project_resp = _mock_response(200, {})

        with patch.object(adapter, "_get_client") as mock_client_fn:
            mock_client = AsyncMock()
            mock_client_fn.return_value = mock_client
            mock_client.post = AsyncMock(return_value=auth_resp)
            mock_client.delete = AsyncMock(side_effect=[delete_identity_resp, delete_project_resp])

            await adapter.deprovision_user("alice")

            assert mock_client.delete.call_count == 2

            # Verify identity deletion
            id_call = mock_client.delete.call_args_list[0]
            assert "skuld-alice" in id_call[0][0]

            # Verify project deletion
            proj_call = mock_client.delete.call_args_list[1]
            assert "user-alice" in proj_call[0][0]

    @pytest.mark.asyncio()
    async def test_deprovision_tolerates_404(self, adapter):
        """404 on delete is acceptable (already cleaned up)."""
        auth_resp = _mock_response(200, {"accessToken": "tok-123"})
        not_found_resp = _mock_response(404, {})

        with patch.object(adapter, "_get_client") as mock_client_fn:
            mock_client = AsyncMock()
            mock_client_fn.return_value = mock_client
            mock_client.post = AsyncMock(return_value=auth_resp)
            mock_client.delete = AsyncMock(return_value=not_found_resp)

            # Should not raise
            await adapter.deprovision_user("alice")

    @pytest.mark.asyncio()
    async def test_provision_user_raises_on_auth_failure(self, adapter):
        auth_fail_resp = _mock_response(401, {"message": "bad creds"})

        with patch.object(adapter, "_get_client") as mock_client_fn:
            mock_client = AsyncMock()
            mock_client_fn.return_value = mock_client
            mock_client.post = AsyncMock(return_value=auth_fail_resp)

            with pytest.raises(RuntimeError, match="Infisical auth failed"):
                await adapter.provision_user("alice")

    @pytest.mark.asyncio()
    async def test_provision_user_raises_on_project_creation_failure(self, adapter):
        auth_resp = _mock_response(200, {"accessToken": "tok-123"})
        project_fail_resp = _mock_response(500, {"message": "internal error"})

        with patch.object(adapter, "_get_client") as mock_client_fn:
            mock_client = AsyncMock()
            mock_client_fn.return_value = mock_client
            mock_client.post = AsyncMock(side_effect=[auth_resp, project_fail_resp])

            with pytest.raises(RuntimeError, match="create project failed"):
                await adapter.provision_user("alice")

    @pytest.mark.asyncio()
    async def test_accepts_extra_kwargs(self):
        """Dynamic adapter pattern: extra kwargs are ignored."""
        adapter = InfisicalCSISecretInjectionAdapter(
            infisical_url="https://test.example.com",
            extra_param="ignored",
        )
        result = await adapter.pod_spec_additions("u1", "s1")
        assert result.service_account == "skuld-u1"
