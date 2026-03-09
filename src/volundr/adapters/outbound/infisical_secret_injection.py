"""Infisical CSI-based SecretInjection adapter.

Returns pod spec fragments for the Secrets Store CSI driver
to inject secrets from Infisical at pod startup. Volundr never
sees secret values -- the CSI driver handles that.
"""

from __future__ import annotations

import logging

import httpx

from volundr.domain.models import PodSpecAdditions
from volundr.domain.ports import SecretInjectionPort

logger = logging.getLogger(__name__)

# Timeout for Infisical HTTP requests (seconds)
_HTTP_TIMEOUT = 30.0


class InfisicalCSISecretInjectionAdapter(SecretInjectionPort):
    """Infisical CSI-based secret injection adapter.

    Returns pod spec fragments for the Secrets Store CSI driver
    to inject secrets from Infisical at pod startup.

    Constructor accepts plain kwargs (dynamic adapter pattern).

    Args:
        infisical_url: Infisical server URL.
        client_id: Universal Auth client ID for management API calls.
        client_secret: Universal Auth client secret.
        namespace: Kubernetes namespace where session pods run.
    """

    def __init__(
        self,
        *,
        infisical_url: str = "https://infisical.example.com",
        client_id: str = "",
        client_secret: str = "",
        namespace: str = "volundr-sessions",
        **_extra: object,
    ) -> None:
        self._infisical_url = infisical_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._namespace = namespace
        self._access_token: str | None = None
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Return (or create) the shared httpx client."""
        if self._client is not None:
            return self._client

        self._client = httpx.AsyncClient(
            base_url=self._infisical_url,
            timeout=_HTTP_TIMEOUT,
        )
        return self._client

    async def _ensure_authenticated(self) -> str:
        """Authenticate via Universal Auth and return access token."""
        if self._access_token:
            return self._access_token

        client = await self._get_client()
        response = await client.post(
            "/api/v1/auth/universal-auth/login",
            json={
                "clientId": self._client_id,
                "clientSecret": self._client_secret,
            },
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Infisical auth failed ({response.status_code}): {response.text}")

        body = response.json()
        self._access_token = body["accessToken"]
        return self._access_token

    async def _headers(self) -> dict[str, str]:
        """Return authorization headers."""
        token = await self._ensure_authenticated()
        return {"Authorization": f"Bearer {token}"}

    def _project_name(self, user_id: str) -> str:
        """Build Infisical project name for a user."""
        return f"user-{user_id}"

    def _identity_name(self, user_id: str) -> str:
        """Build machine identity name for a user."""
        return f"skuld-{user_id}"

    def _service_account_name(self, user_id: str) -> str:
        """Build Kubernetes service account name for a user."""
        return f"skuld-{user_id}"

    def _secret_provider_class(self, user_id: str) -> str:
        """Build SecretProviderClass name for a user."""
        return f"infisical-{user_id}"

    async def pod_spec_additions(
        self,
        user_id: str,
        session_id: str,
    ) -> PodSpecAdditions:
        """Return pod spec contributions for CSI secret injection."""
        sa_name = self._service_account_name(user_id)
        spc_name = self._secret_provider_class(user_id)
        volume_name = f"secrets-{session_id}"

        return PodSpecAdditions(
            service_account=sa_name,
            volumes=(
                {
                    "name": volume_name,
                    "csi": {
                        "driver": "secrets-store.csi.k8s.io",
                        "readOnly": True,
                        "volumeAttributes": {
                            "secretProviderClass": spc_name,
                        },
                    },
                },
            ),
            volume_mounts=(
                {
                    "name": volume_name,
                    "mountPath": "/run/secrets/user",
                    "readOnly": True,
                },
            ),
        )

    async def provision_user(self, user_id: str) -> None:
        """Create Infisical project and machine identity for a user.

        Creates:
        - An Infisical project named ``user-{user_id}``
        - A machine identity named ``skuld-{user_id}`` with k8s auth
          bound to service account ``skuld-{user_id}`` in the configured
          namespace.
        """
        client = await self._get_client()
        headers = await self._headers()
        project_name = self._project_name(user_id)
        identity_name = self._identity_name(user_id)

        # Create project
        resp = await client.post(
            "/api/v2/workspace",
            headers=headers,
            json={"projectName": project_name},
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Infisical create project failed ({resp.status_code}): {resp.text}")
        project_id = resp.json()["workspace"]["id"]
        logger.info(
            "Created Infisical project %s (id=%s) for user %s",
            project_name,
            project_id,
            user_id,
        )

        # Create machine identity
        resp = await client.post(
            "/api/v1/identities",
            headers=headers,
            json={
                "name": identity_name,
                "role": "member",
            },
        )
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Infisical create identity failed ({resp.status_code}): {resp.text}"
            )
        identity_id = resp.json()["identity"]["id"]

        # Configure k8s auth for the identity
        sa_name = self._service_account_name(user_id)
        resp = await client.post(
            f"/api/v1/identities/{identity_id}/kubernetes-auth",
            headers=headers,
            json={
                "allowedServiceAccounts": sa_name,
                "allowedNamespaces": self._namespace,
            },
        )
        if resp.status_code >= 400:
            raise RuntimeError(
                f"Infisical k8s auth config failed ({resp.status_code}): {resp.text}"
            )

        logger.info(
            "Provisioned identity %s with k8s auth (sa=%s, ns=%s)",
            identity_name,
            sa_name,
            self._namespace,
        )

    async def deprovision_user(self, user_id: str) -> None:
        """Delete machine identity and Infisical project for a user."""
        client = await self._get_client()
        headers = await self._headers()
        identity_name = self._identity_name(user_id)
        project_name = self._project_name(user_id)

        # Delete identity (best-effort)
        resp = await client.delete(
            f"/api/v1/identities/by-name/{identity_name}",
            headers=headers,
        )
        if resp.status_code >= 400 and resp.status_code != 404:
            logger.warning(
                "Failed to delete identity %s: %s %s",
                identity_name,
                resp.status_code,
                resp.text,
            )

        # Delete project (best-effort)
        resp = await client.delete(
            f"/api/v2/workspace/by-name/{project_name}",
            headers=headers,
        )
        if resp.status_code >= 400 and resp.status_code != 404:
            logger.warning(
                "Failed to delete project %s: %s %s",
                project_name,
                resp.status_code,
                resp.text,
            )

        logger.info("Deprovisioned user %s from Infisical", user_id)

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
