"""Infisical CredentialStore adapter.

Implements CredentialStorePort using the Infisical REST API.
Stores each credential field as a separate Infisical secret, organized
in folders: ``/{owner_type}s/{owner_id}/{credential_name}/{field_name}``.

Metadata is stored as a separate ``__meta__`` secret in the credential folder.
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

_HTTP_TIMEOUT = 30.0
_META_KEY = "__meta__"


class InfisicalCredentialStore(CredentialStorePort):
    """Infisical implementation of CredentialStorePort.

    Stores each credential field as a separate Infisical secret so that
    the Infisical Agent Injector can reference individual fields in Go
    templates (e.g. ``getSecretByName(proj, env, folder, fieldName)``).

    Folder layout::

        /users/{user_id}/
            {credential_name}/
                api_key          → "sk-abc123"
                org_id           → "org-xyz"
                __meta__         → JSON metadata blob

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
            raise RuntimeError(f"Infisical auth failed ({response.status_code})")
        self._access_token = response.json()["accessToken"]
        return self._access_token

    async def _headers(self) -> dict[str, str]:
        token = await self._ensure_authenticated()
        return {"Authorization": f"Bearer {token}"}

    def _credential_folder(self, owner_type: str, owner_id: str, name: str) -> str:
        """Build folder path for a credential's fields."""
        return f"/{owner_type}s/{owner_id}/{name}"

    def _owner_folder(self, owner_type: str, owner_id: str) -> str:
        """Build folder path for an owner (lists all credentials)."""
        return f"/{owner_type}s/{owner_id}"

    async def _ensure_folder(self, folder_path: str) -> None:
        """Create the folder path in Infisical if it doesn't exist."""
        client = await self._get_client()
        headers = await self._headers()

        parts = [p for p in folder_path.strip("/").split("/") if p]
        current = "/"
        for part in parts:
            await client.post(
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
            current = f"{current}{part}/" if current.endswith("/") else f"{current}/{part}/"

    async def _create_or_update_secret(
        self,
        key: str,
        value: str,
        folder_path: str,
        comment: str = "",
    ) -> None:
        """Create or update a single Infisical secret."""
        client = await self._get_client()
        headers = await self._headers()

        response = await client.post(
            f"/api/v3/secrets/raw/{key}",
            headers=headers,
            json={
                "workspaceId": self._project_id,
                "environment": self._environment,
                "secretPath": folder_path,
                "secretValue": value,
                "secretComment": comment,
                "type": "shared",
            },
        )

        if response.status_code == 400:
            # Secret may already exist, try update
            response = await client.patch(
                f"/api/v3/secrets/raw/{key}",
                headers=headers,
                json={
                    "workspaceId": self._project_id,
                    "environment": self._environment,
                    "secretPath": folder_path,
                    "secretValue": value,
                    "secretComment": comment,
                    "type": "shared",
                },
            )

        if response.status_code >= 400:
            raise RuntimeError(f"Infisical secret write failed for {key} ({response.status_code})")

    async def _delete_secret(self, key: str, folder_path: str) -> None:
        """Delete a single Infisical secret."""
        client = await self._get_client()
        headers = await self._headers()

        response = await client.request(
            "DELETE",
            f"/api/v3/secrets/raw/{key}",
            headers=headers,
            json={
                "workspaceId": self._project_id,
                "environment": self._environment,
                "secretPath": folder_path,
                "type": "shared",
            },
        )
        if response.status_code >= 400 and response.status_code != 404:
            logger.error(
                "Infisical delete failed for secret in %s (HTTP %s)",
                folder_path,
                response.status_code,
            )

    async def _list_secrets_in_folder(self, folder_path: str) -> list[dict]:
        """List all secrets in a folder."""
        client = await self._get_client()
        headers = await self._headers()

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
            logger.error("Infisical list failed: %s", response.status_code)
            return []

        return response.json().get("secrets", [])

    async def _list_subfolders(self, folder_path: str) -> list[str]:
        """List subfolder names under a folder."""
        client = await self._get_client()
        headers = await self._headers()

        response = await client.get(
            "/api/v1/folders",
            headers=headers,
            params={
                "workspaceId": self._project_id,
                "environment": self._environment,
                "path": folder_path,
            },
        )
        if response.status_code == 404:
            return []
        if response.status_code >= 400:
            logger.error("Infisical folder list failed: %s", response.status_code)
            return []

        folders = response.json().get("folders", [])
        return [f["name"] for f in folders]

    async def close(self) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    # ------------------------------------------------------------------
    # CredentialStorePort implementation
    # ------------------------------------------------------------------

    async def store(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
        secret_type: SecretType,
        data: dict[str, str],
        metadata: dict | None = None,
    ) -> StoredCredential:
        now = datetime.now(UTC)
        existing = await self.get(owner_type, owner_id, name)
        cred_id = existing.id if existing else str(uuid4())
        created_at = existing.created_at if existing else now

        folder_path = self._credential_folder(owner_type, owner_id, name)
        await self._ensure_folder(folder_path)

        # Store each field as a separate secret
        for field_name, field_value in data.items():
            await self._create_or_update_secret(
                key=field_name,
                value=field_value,
                folder_path=folder_path,
            )

        # Store metadata as a __meta__ secret
        meta_json = json.dumps(
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
        await self._create_or_update_secret(
            key=_META_KEY,
            value=meta_json,
            folder_path=folder_path,
        )

        # Clean up stale fields (fields removed on update)
        if existing:
            stale_keys = set(existing.keys) - set(data.keys())
            for stale_key in stale_keys:
                await self._delete_secret(stale_key, folder_path)

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

    async def get(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
    ) -> StoredCredential | None:
        folder_path = self._credential_folder(owner_type, owner_id, name)
        secrets = await self._list_secrets_in_folder(folder_path)

        for secret in secrets:
            if secret.get("secretKey") == _META_KEY:
                return self._parse_meta(secret.get("secretValue", ""))

        return None

    async def get_value(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
    ) -> dict[str, str] | None:
        folder_path = self._credential_folder(owner_type, owner_id, name)
        secrets = await self._list_secrets_in_folder(folder_path)

        if not secrets:
            return None

        result: dict[str, str] = {}
        for secret in secrets:
            key = secret.get("secretKey", "")
            if key == _META_KEY:
                continue
            result[key] = secret.get("secretValue", "")

        return result if result else None

    async def delete(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
    ) -> None:
        folder_path = self._credential_folder(owner_type, owner_id, name)
        secrets = await self._list_secrets_in_folder(folder_path)

        for secret in secrets:
            key = secret.get("secretKey", "")
            if key:
                await self._delete_secret(key, folder_path)

        # Delete the folder itself
        client = await self._get_client()
        headers = await self._headers()
        await client.request(
            "DELETE",
            "/api/v1/folders",
            headers=headers,
            json={
                "workspaceId": self._project_id,
                "environment": self._environment,
                "path": self._owner_folder(owner_type, owner_id),
                "name": name,
            },
        )

    async def list(
        self,
        owner_type: str,
        owner_id: str,
        secret_type: SecretType | None = None,
    ) -> list[StoredCredential]:
        owner_folder = self._owner_folder(owner_type, owner_id)
        credential_names = await self._list_subfolders(owner_folder)

        results: list[StoredCredential] = []
        for cred_name in credential_names:
            cred = await self.get(owner_type, owner_id, cred_name)
            if cred is None:
                continue
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

    @staticmethod
    def _parse_meta(meta_value: str) -> StoredCredential | None:
        if not meta_value:
            return None
        try:
            meta = json.loads(meta_value)
        except (json.JSONDecodeError, KeyError):
            return None

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
