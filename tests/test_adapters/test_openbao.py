"""Tests for OpenBaoSecretRepository adapter."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from volundr.adapters.outbound.openbao import (
    OpenBaoApiError,
    OpenBaoConfig,
    OpenBaoSecretRepository,
)
from volundr.domain.models import MountType, SecretMountSpec

BAO_URL = "https://bao.example.com"


@pytest.fixture
def config() -> OpenBaoConfig:
    """Create OpenBao config for testing."""
    return OpenBaoConfig(
        url=BAO_URL,
        token="test-root-token",
        mount_path="volundr",
        k8s_auth_path="auth/kubernetes",
        session_namespace="volundr-sessions",
        session_ttl="24h",
    )


@pytest.fixture
def repo(config: OpenBaoConfig) -> OpenBaoSecretRepository:
    """Create repo with an httpx client (mocked by respx)."""
    client = httpx.AsyncClient(
        base_url=config.url,
        headers={"X-Vault-Token": config.token},
    )
    return OpenBaoSecretRepository(config, client=client)


class TestStoreCredential:
    """Tests for store_credential."""

    @respx.mock
    async def test_makes_correct_post(
        self, repo: OpenBaoSecretRepository,
    ):
        route = respx.post(
            f"{BAO_URL}/v1/volundr/data/users/u1/keys/my-key",
        ).respond(status_code=200, json={})

        await repo.store_credential(
            "users/u1/keys/my-key",
            {"api_key": "secret"},
        )

        assert route.called
        body = json.loads(
            route.calls.last.request.content,
        )
        assert body == {"data": {"api_key": "secret"}}

    @respx.mock
    async def test_raises_on_error(
        self, repo: OpenBaoSecretRepository,
    ):
        respx.post(
            f"{BAO_URL}/v1/volundr/data/path",
        ).respond(status_code=500, text="internal error")

        with pytest.raises(OpenBaoApiError) as exc_info:
            await repo.store_credential("path", {"k": "v"})
        assert exc_info.value.status_code == 500


class TestGetCredential:
    """Tests for get_credential."""

    @respx.mock
    async def test_parses_kv_v2_response(
        self, repo: OpenBaoSecretRepository,
    ):
        respx.get(
            f"{BAO_URL}/v1/volundr/data/users/u1/keys/my-key",
        ).respond(
            status_code=200,
            json={
                "data": {
                    "data": {
                        "api_key": "secret-123",
                        "host": "example.com",
                    },
                    "metadata": {
                        "version": 1,
                    },
                },
            },
        )

        result = await repo.get_credential(
            "users/u1/keys/my-key",
        )
        assert result == {
            "api_key": "secret-123",
            "host": "example.com",
        }

    @respx.mock
    async def test_returns_none_on_404(
        self, repo: OpenBaoSecretRepository,
    ):
        respx.get(
            f"{BAO_URL}/v1/volundr/data/missing",
        ).respond(status_code=404)

        result = await repo.get_credential("missing")
        assert result is None

    @respx.mock
    async def test_raises_on_server_error(
        self, repo: OpenBaoSecretRepository,
    ):
        respx.get(
            f"{BAO_URL}/v1/volundr/data/err",
        ).respond(status_code=503, text="unavailable")

        with pytest.raises(OpenBaoApiError):
            await repo.get_credential("err")


class TestDeleteCredential:
    """Tests for delete_credential."""

    @respx.mock
    async def test_returns_true_on_success(
        self, repo: OpenBaoSecretRepository,
    ):
        respx.delete(
            f"{BAO_URL}/v1/volundr/data/p",
        ).respond(status_code=204)

        assert await repo.delete_credential("p") is True

    @respx.mock
    async def test_returns_false_on_404(
        self, repo: OpenBaoSecretRepository,
    ):
        respx.delete(
            f"{BAO_URL}/v1/volundr/data/gone",
        ).respond(status_code=404)

        assert await repo.delete_credential("gone") is False


class TestListCredentials:
    """Tests for list_credentials."""

    @respx.mock
    async def test_parses_list_response(
        self, repo: OpenBaoSecretRepository,
    ):
        respx.get(
            f"{BAO_URL}/v1/volundr/metadata/users/u1/keys",
        ).respond(
            status_code=200,
            json={
                "data": {
                    "keys": ["cred-a", "cred-b"],
                },
            },
        )

        result = await repo.list_credentials(
            "users/u1/keys",
        )
        assert result == ["cred-a", "cred-b"]

    @respx.mock
    async def test_returns_empty_on_404(
        self, repo: OpenBaoSecretRepository,
    ):
        respx.get(
            f"{BAO_URL}/v1/volundr/metadata/empty",
        ).respond(status_code=404)

        result = await repo.list_credentials("empty")
        assert result == []


class TestProvisionUser:
    """Tests for provision_user (policy + K8s role)."""

    @respx.mock
    async def test_creates_policy_and_role(
        self, repo: OpenBaoSecretRepository,
    ):
        policy_route = respx.put(
            f"{BAO_URL}/v1/sys/policies/acl/"
            f"volundr-user-user-42",
        ).respond(status_code=204)

        role_route = respx.post(
            f"{BAO_URL}/v1/auth/kubernetes/role/"
            f"volundr-user-user-42",
        ).respond(status_code=204)

        await repo.provision_user("user-42", "tenant-1")

        assert policy_route.called
        policy_body = json.loads(
            policy_route.calls.last.request.content,
        )
        assert "volundr/data/users/user-42" in (
            policy_body["policy"]
        )
        assert "tenants/tenant-1" in policy_body["policy"]

        assert role_route.called
        role_body = json.loads(
            role_route.calls.last.request.content,
        )
        assert role_body["policies"] == [
            "volundr-user-user-42",
        ]
        assert (
            "volundr-session-user-user-42-*"
            in role_body["bound_service_account_names"]
        )


class TestDeprovisionUser:
    """Tests for deprovision_user."""

    @respx.mock
    async def test_deletes_role_and_policy(
        self, repo: OpenBaoSecretRepository,
    ):
        role_route = respx.delete(
            f"{BAO_URL}/v1/auth/kubernetes/role/"
            f"volundr-user-user-42",
        ).respond(status_code=204)

        policy_route = respx.delete(
            f"{BAO_URL}/v1/sys/policies/acl/"
            f"volundr-user-user-42",
        ).respond(status_code=204)

        await repo.deprovision_user("user-42")

        assert role_route.called
        assert policy_route.called

    @respx.mock
    async def test_tolerates_404_on_delete(
        self, repo: OpenBaoSecretRepository,
    ):
        respx.delete(
            f"{BAO_URL}/v1/auth/kubernetes/role/"
            f"volundr-user-ghost",
        ).respond(status_code=404)

        respx.delete(
            f"{BAO_URL}/v1/sys/policies/acl/"
            f"volundr-user-ghost",
        ).respond(status_code=404)

        # Should not raise
        await repo.deprovision_user("ghost")


class TestCreateSessionSecrets:
    """Tests for create_session_secrets."""

    @respx.mock
    async def test_stores_manifest(
        self, repo: OpenBaoSecretRepository,
    ):
        route = respx.post(
            f"{BAO_URL}/v1/volundr/data/"
            f"sessions/s1/manifest",
        ).respond(status_code=200, json={})

        mounts = [
            SecretMountSpec(
                secret_path="users/u1/keys/api",
                mount_type=MountType.ENV_FILE,
                destination="/home/volundr/.env",
            ),
        ]
        await repo.create_session_secrets("s1", "u1", mounts)

        assert route.called
        body = json.loads(
            route.calls.last.request.content,
        )
        manifest = json.loads(body["data"]["manifest"])
        assert manifest["user_id"] == "u1"
        assert len(manifest["mounts"]) == 1


class TestDeleteSessionSecrets:
    """Tests for delete_session_secrets."""

    @respx.mock
    async def test_cleans_up_manifest(
        self, repo: OpenBaoSecretRepository,
    ):
        # list returns one sub-key
        respx.get(
            f"{BAO_URL}/v1/volundr/metadata/sessions/s1",
        ).respond(
            status_code=200,
            json={"data": {"keys": ["manifest"]}},
        )

        # delete sub-key
        respx.delete(
            f"{BAO_URL}/v1/volundr/data/"
            f"sessions/s1/manifest",
        ).respond(status_code=204)

        await repo.delete_session_secrets("s1")
