"""Infisical CredentialStore adapter.

Implements CredentialStorePort using the Infisical REST API.
Stores credentials as Infisical secrets with metadata in the comment field.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from uuid import uuid4

import httpx

from volundr.domain.models import SecretType, StoredCredential
from volundr.domain.ports import CredentialStorePort

logger = logging.getLogger(__name__)

# Timeout for Infisical HTTP requests (seconds)
_HTTP_TIMEOUT = 30.0


class InfisicalCredentialStore(CredentialStorePort):
    """Infisical implementation of CredentialStorePort.

    Constructor kwargs (from dynamic adapter config):
        site_url: Infisical server URL.
        client_id: Universal Auth client ID.
        client_secret: Universal Auth client secret.
        project_id: Infisical project ID.
        environment: Environment slug (default "dev").
    """

    def __init__(
        self,
        site_url: str = "https://app.infisical.com",
        client_id: str = "",
        client_secret: str = "",
        project_id: str = "",
        environment: str = "dev",
    ) -> None:
        self._site_url = site_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._project_id = project_id
        self._environment = environment
        self._access_token: str | None = None
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client

        self._client = httpx.AsyncClient(
            base_url=self._site_url,
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
        token = await self._ensure_authenticated()
        return {"Authorization": f"Bearer {token}"}

    def _secret_key(self, owner_type: str, owner_id: str, name: str) -> str:
        """Build Infisical secret key from owner/name."""
        return f"VOLUNDR__{owner_type.upper()}__{owner_id}__{name}".replace("-", "_")

    def _folder_path(self, owner_type: str, owner_id: str) -> str:
        """Build Infisical folder path."""
        return f"/{owner_type}s/{owner_id}"

    async def _ensure_folder(self, folder_path: str) -> None:
        """Create the folder path in Infisical if it doesn't exist."""
        client = await self._get_client()
        headers = await self._headers()

        # Split path into parts and create each level
        parts = [p for p in folder_path.strip("/").split("/") if p]
        current = "/"
        for part in parts:
            response = await client.post(
                "/api/v1/folders",
                headers=headers,
                json={
                    "workspaceId": self._project_id,
                    "environment": self._environment,
                    "name": part,
                    "path": current,
                },
            )
            # 400 means folder already exists — that's fine
            if response.status_code >= 400 and response.status_code != 400:
                logger.warning(
                    "Infisical folder create failed: %s %s",
                    response.status_code,
                    response.text,
                )
            current = f"{current}{part}/" if current.endswith("/") else f"{current}/{part}/"

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def store(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
        secret_type: SecretType,
        data: dict[str, str],
        metadata: dict | None = None,
    ) -> StoredCredential:
        client = await self._get_client()
        headers = await self._headers()
        now = datetime.now(UTC)

        existing = await self.get(owner_type, owner_id, name)
        cred_id = existing.id if existing else str(uuid4())
        created_at = existing.created_at if existing else now

        secret_key = self._secret_key(owner_type, owner_id, name)
        folder_path = self._folder_path(owner_type, owner_id)

        meta_comment = json.dumps(
            {
                "id": cred_id,
                "name": name,
                "secret_type": secret_type.value,
                "keys": list(data.keys()),
                "metadata": metadata or {},
                "owner_id": owner_id,
                "owner_type": owner_type,
                "created_at": created_at.isoformat(),
                "updated_at": now.isoformat(),
            }
        )

        secret_value = json.dumps(data)

        # Ensure the folder path exists before creating the secret
        await self._ensure_folder(folder_path)

        # Try create first, fall back to update
        response = await client.post(
            f"/api/v3/secrets/raw/{secret_key}",
            headers=headers,
            json={
                "workspaceId": self._project_id,
                "environment": self._environment,
                "secretPath": folder_path,
                "secretValue": secret_value,
                "secretComment": meta_comment,
                "type": "shared",
            },
        )

        if response.status_code == 400:
            # Secret may already exist, try update
            response = await client.patch(
                f"/api/v3/secrets/raw/{secret_key}",
                headers=headers,
                json={
                    "workspaceId": self._project_id,
                    "environment": self._environment,
                    "secretPath": folder_path,
                    "secretValue": secret_value,
                    "secretComment": meta_comment,
                    "type": "shared",
                },
            )

        if response.status_code >= 400:
            raise RuntimeError(f"Infisical store failed ({response.status_code}): {response.text}")

        return StoredCredential(
            id=cred_id,
            name=name,
            secret_type=secret_type,
            keys=tuple(data.keys()),
            metadata=metadata or {},
            owner_id=owner_id,
            owner_type=owner_type,
            created_at=created_at,
            updated_at=now,
        )

    async def _get_raw(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
    ) -> dict | None:
        """Get raw Infisical secret response."""
        client = await self._get_client()
        headers = await self._headers()
        secret_key = self._secret_key(owner_type, owner_id, name)
        folder_path = self._folder_path(owner_type, owner_id)

        response = await client.get(
            f"/api/v3/secrets/raw/{secret_key}",
            headers=headers,
            params={
                "workspaceId": self._project_id,
                "environment": self._environment,
                "secretPath": folder_path,
                "type": "shared",
            },
        )

        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            logger.error("Infisical get failed: %s %s", response.status_code, response.text)
            return None

        return response.json().get("secret")

    async def get(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
    ) -> StoredCredential | None:
        raw = await self._get_raw(owner_type, owner_id, name)
        if raw is None:
            return None

        comment = raw.get("secretComment", "")
        if not comment:
            return None

        meta = json.loads(comment)
        return StoredCredential(
            id=meta["id"],
            name=meta["name"],
            secret_type=SecretType(meta["secret_type"]),
            keys=tuple(meta["keys"]),
            metadata=meta.get("metadata", {}),
            owner_id=meta["owner_id"],
            owner_type=meta["owner_type"],
            created_at=datetime.fromisoformat(meta["created_at"]),
            updated_at=datetime.fromisoformat(meta["updated_at"]),
        )

    async def get_value(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
    ) -> dict[str, str] | None:
        raw = await self._get_raw(owner_type, owner_id, name)
        if raw is None:
            return None

        secret_value = raw.get("secretValue", "")
        if not secret_value:
            return None

        return json.loads(secret_value)

    async def delete(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
    ) -> None:
        client = await self._get_client()
        headers = await self._headers()
        secret_key = self._secret_key(owner_type, owner_id, name)
        folder_path = self._folder_path(owner_type, owner_id)

        response = await client.delete(
            f"/api/v3/secrets/raw/{secret_key}",
            headers=headers,
            params={
                "workspaceId": self._project_id,
                "environment": self._environment,
                "secretPath": folder_path,
                "type": "shared",
            },
        )
        if response.status_code >= 400 and response.status_code != 404:
            logger.error(
                "Infisical delete failed: %s %s",
                response.status_code,
                response.text,
            )

    async def list(
        self,
        owner_type: str,
        owner_id: str,
        secret_type: SecretType | None = None,
    ) -> list[StoredCredential]:
        client = await self._get_client()
        headers = await self._headers()
        folder_path = self._folder_path(owner_type, owner_id)

        response = await client.get(
            "/api/v3/secrets/raw",
            headers=headers,
            params={
                "workspaceId": self._project_id,
                "environment": self._environment,
                "secretPath": folder_path,
            },
        )
        if response.status_code == 404:
            return []
        if response.status_code >= 400:
            logger.error("Infisical list failed: %s %s", response.status_code, response.text)
            return []

        secrets = response.json().get("secrets", [])
        results: list[StoredCredential] = []

        for secret in secrets:
            comment = secret.get("secretComment", "")
            if not comment:
                continue

            try:
                meta = json.loads(comment)
            except (json.JSONDecodeError, KeyError):
                continue

            cred = StoredCredential(
                id=meta["id"],
                name=meta["name"],
                secret_type=SecretType(meta["secret_type"]),
                keys=tuple(meta["keys"]),
                metadata=meta.get("metadata", {}),
                owner_id=meta["owner_id"],
                owner_type=meta["owner_type"],
                created_at=datetime.fromisoformat(meta["created_at"]),
                updated_at=datetime.fromisoformat(meta["updated_at"]),
            )

            if secret_type is not None and cred.secret_type != secret_type:
                continue
            results.append(cred)

        return sorted(results, key=lambda c: c.name)

    async def health_check(self) -> bool:
        try:
            client = await self._get_client()
            response = await client.get("/api/status")
            return response.status_code < 400
        except Exception:
            logger.exception("Infisical health check failed")
            return False
