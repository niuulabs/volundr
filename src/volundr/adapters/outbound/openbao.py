"""OpenBao adapter for secret management.

Uses the Vault-compatible HTTP API (KV v2) via httpx.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import httpx

from volundr.domain.models import SecretMountSpec
from volundr.domain.ports import SecretRepository

logger = logging.getLogger(__name__)


@dataclass
class OpenBaoConfig:
    """Configuration for the OpenBao adapter."""

    url: str = "http://openbao.volundr-system:8200"
    token: str = ""
    mount_path: str = "volundr"
    k8s_auth_path: str = "auth/kubernetes"
    session_namespace: str = "volundr-sessions"
    session_ttl: str = "24h"


class OpenBaoApiError(Exception):
    """Raised when OpenBao API returns an error."""

    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(
            f"OpenBao API error ({status_code}): {message}"
        )


# HCL policy template for user provisioning.
_USER_POLICY_TEMPLATE = """\
path "{mount}/data/users/{user_id}/*" {{
    capabilities = ["create", "read", "update", "delete"]
}}
path "{mount}/data/tenants/{tenant_id}/shared/*" {{
    capabilities = ["read"]
}}
path "{mount}/data/sessions/+/*" {{
    capabilities = ["read"]
}}
"""


class OpenBaoSecretRepository(SecretRepository):
    """OpenBao/Vault implementation of SecretRepository.

    Uses the Vault-compatible KV v2 HTTP API for credential
    storage, user provisioning, and ephemeral session secrets.
    """

    def __init__(
        self,
        config: OpenBaoConfig,
        client: httpx.AsyncClient | None = None,
    ):
        self._config = config
        self._client = client
        self._owns_client = client is None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is not None:
            return self._client

        self._client = httpx.AsyncClient(
            base_url=self._config.url,
            headers={"X-Vault-Token": self._config.token},
            timeout=30.0,
        )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client if we own it."""
        if self._client and self._owns_client:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------
    # KV v2 CRUD
    # ------------------------------------------------------------------

    async def store_credential(
        self,
        path: str,
        data: dict[str, str],
    ) -> None:
        """Store a credential at the given KV v2 path."""
        client = await self._get_client()
        mount = self._config.mount_path

        response = await client.post(
            f"/v1/{mount}/data/{path}",
            json={"data": data},
        )
        if response.status_code >= 400:
            raise OpenBaoApiError(
                response.status_code, response.text,
            )

    async def get_credential(
        self,
        path: str,
    ) -> dict | None:
        """Read a credential from the given KV v2 path."""
        client = await self._get_client()
        mount = self._config.mount_path

        response = await client.get(
            f"/v1/{mount}/data/{path}",
        )
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise OpenBaoApiError(
                response.status_code, response.text,
            )

        body = response.json()
        return body.get("data", {}).get("data")

    async def delete_credential(self, path: str) -> bool:
        """Delete a credential at the given KV v2 path."""
        client = await self._get_client()
        mount = self._config.mount_path

        response = await client.delete(
            f"/v1/{mount}/data/{path}",
        )
        if response.status_code == 404:
            return False
        if response.status_code >= 400:
            raise OpenBaoApiError(
                response.status_code, response.text,
            )
        return True

    async def list_credentials(
        self,
        path_prefix: str,
    ) -> list[str]:
        """List credential keys under a KV v2 metadata path."""
        client = await self._get_client()
        mount = self._config.mount_path

        response = await client.get(
            f"/v1/{mount}/metadata/{path_prefix}",
            params={"list": "true"},
        )
        if response.status_code == 404:
            return []
        if response.status_code >= 400:
            raise OpenBaoApiError(
                response.status_code, response.text,
            )

        body = response.json()
        return body.get("data", {}).get("keys", [])

    # ------------------------------------------------------------------
    # User provisioning
    # ------------------------------------------------------------------

    async def provision_user(
        self,
        user_id: str,
        tenant_id: str,
    ) -> None:
        """Create vault policy and K8s auth role for a user."""
        await self._create_policy(user_id, tenant_id)
        await self._create_k8s_role(user_id)

    async def deprovision_user(self, user_id: str) -> None:
        """Remove vault policy and K8s auth role for a user."""
        await self._delete_k8s_role(user_id)
        await self._delete_policy(user_id)

    async def _create_policy(
        self,
        user_id: str,
        tenant_id: str,
    ) -> None:
        """Create an ACL policy for a user."""
        client = await self._get_client()
        policy_name = f"volundr-user-{user_id}"

        policy_hcl = _USER_POLICY_TEMPLATE.format(
            mount=self._config.mount_path,
            user_id=user_id,
            tenant_id=tenant_id,
        )

        response = await client.put(
            f"/v1/sys/policies/acl/{policy_name}",
            json={"policy": policy_hcl},
        )
        if response.status_code >= 400:
            raise OpenBaoApiError(
                response.status_code, response.text,
            )

        logger.info(
            "Created policy %s for user %s",
            policy_name, user_id,
        )

    async def _delete_policy(self, user_id: str) -> None:
        """Delete an ACL policy for a user."""
        client = await self._get_client()
        policy_name = f"volundr-user-{user_id}"

        response = await client.delete(
            f"/v1/sys/policies/acl/{policy_name}",
        )
        if response.status_code == 404:
            logger.debug(
                "Policy %s not found, skipping delete",
                policy_name,
            )
            return
        if response.status_code >= 400:
            raise OpenBaoApiError(
                response.status_code, response.text,
            )

        logger.info("Deleted policy %s", policy_name)

    async def _create_k8s_role(self, user_id: str) -> None:
        """Create a Kubernetes auth role for a user."""
        client = await self._get_client()
        role_name = f"volundr-user-{user_id}"
        k8s_path = self._config.k8s_auth_path

        payload = {
            "bound_service_account_names": [
                f"volundr-session-user-{user_id}-*",
            ],
            "bound_service_account_namespaces": [
                self._config.session_namespace,
            ],
            "policies": [role_name],
            "ttl": self._config.session_ttl,
        }

        response = await client.post(
            f"/v1/{k8s_path}/role/{role_name}",
            json=payload,
        )
        if response.status_code >= 400:
            raise OpenBaoApiError(
                response.status_code, response.text,
            )

        logger.info(
            "Created K8s auth role %s for user %s",
            role_name, user_id,
        )

    async def _delete_k8s_role(self, user_id: str) -> None:
        """Delete a Kubernetes auth role for a user."""
        client = await self._get_client()
        role_name = f"volundr-user-{user_id}"
        k8s_path = self._config.k8s_auth_path

        response = await client.delete(
            f"/v1/{k8s_path}/role/{role_name}",
        )
        if response.status_code == 404:
            logger.debug(
                "K8s role %s not found, skipping delete",
                role_name,
            )
            return
        if response.status_code >= 400:
            raise OpenBaoApiError(
                response.status_code, response.text,
            )

        logger.info("Deleted K8s auth role %s", role_name)

    # ------------------------------------------------------------------
    # Session secrets
    # ------------------------------------------------------------------

    async def create_session_secrets(
        self,
        session_id: str,
        user_id: str,
        mounts: list[SecretMountSpec],
    ) -> None:
        """Store ephemeral secrets for a session."""
        session_path = f"sessions/{session_id}"

        manifest = {
            "user_id": user_id,
            "mounts": [
                {
                    "secret_path": m.secret_path,
                    "mount_type": m.mount_type.value
                    if hasattr(m.mount_type, "value")
                    else str(m.mount_type),
                    "destination": m.destination,
                    "template": m.template,
                    "renewal": m.renewal,
                }
                for m in mounts
            ],
        }

        await self.store_credential(
            f"{session_path}/manifest",
            {"manifest": json.dumps(manifest)},
        )

        logger.info(
            "Created session secrets for session %s "
            "(user %s, %d mounts)",
            session_id, user_id, len(mounts),
        )

    async def delete_session_secrets(
        self,
        session_id: str,
    ) -> None:
        """Delete all ephemeral secrets for a session."""
        session_path = f"sessions/{session_id}"

        keys = await self.list_credentials(session_path)
        for key in keys:
            sub = key.rstrip("/")
            await self.delete_credential(
                f"{session_path}/{sub}",
            )

        # Delete the session prefix itself.
        await self.delete_credential(
            f"{session_path}/manifest",
        )

        logger.info(
            "Deleted session secrets for session %s",
            session_id,
        )
