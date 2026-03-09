"""Vault/OpenBao CredentialStore adapter.

Implements CredentialStorePort using the Vault-compatible KV v2 HTTP API.
Stores metadata alongside secret values at structured paths.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import PurePosixPath
from uuid import uuid4

import httpx

from volundr.domain.models import SecretType, StoredCredential
from volundr.domain.ports import CredentialStorePort

logger = logging.getLogger(__name__)

# Timeout for Vault HTTP requests (seconds)
_HTTP_TIMEOUT = 30.0


class VaultCredentialStore(CredentialStorePort):
    """Vault/OpenBao KV v2 implementation of CredentialStorePort.

    Constructor kwargs (from dynamic adapter config):
        url: Vault server URL.
        auth_method: Authentication method ("token" or "kubernetes").
        mount_path: KV v2 mount path.
        token: Static token (only when auth_method="token").
    """

    def __init__(
        self,
        url: str = "http://openbao.volundr-system:8200",
        auth_method: str = "kubernetes",
        mount_path: str = "secret",
        token: str = "",
    ) -> None:
        self._url = url
        self._auth_method = auth_method
        self._mount_path = mount_path
        self._token = token
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client

        headers: dict[str, str] = {}
        if self._token:
            headers["X-Vault-Token"] = self._token

        self._client = httpx.AsyncClient(
            base_url=self._url,
            headers=headers,
            timeout=_HTTP_TIMEOUT,
        )
        return self._client

    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    def _data_path(self, owner_type: str, owner_id: str, name: str) -> str:
        return str(PurePosixPath(self._mount_path, "data", f"{owner_type}s", owner_id, name))

    def _metadata_path(self, owner_type: str, owner_id: str, name: str) -> str:
        return str(PurePosixPath(self._mount_path, "metadata", f"{owner_type}s", owner_id, name))

    def _list_path(self, owner_type: str, owner_id: str) -> str:
        return str(PurePosixPath(self._mount_path, "metadata", f"{owner_type}s", owner_id))

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
        path = self._data_path(owner_type, owner_id, name)
        now = datetime.now(UTC)

        # Read existing to preserve created_at and id
        existing = await self.get(owner_type, owner_id, name)
        cred_id = existing.id if existing else str(uuid4())
        created_at = existing.created_at if existing else now

        # Store combined payload (secret data + credential metadata)
        payload = dict(data)
        payload["__meta__"] = json.dumps(
            {
                "id": cred_id,
                "secret_type": secret_type.value,
                "keys": list(data.keys()),
                "metadata": metadata or {},
                "owner_id": owner_id,
                "owner_type": owner_type,
                "created_at": created_at.isoformat(),
                "updated_at": now.isoformat(),
            }
        )

        response = await client.post(
            f"/v1/{path}",
            json={"data": payload},
        )
        if response.status_code >= 400:
            logger.error("Vault store failed: %s %s", response.status_code, response.text)
            raise RuntimeError(f"Vault store error ({response.status_code}): {response.text}")

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

    async def _read_raw(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
    ) -> dict[str, str] | None:
        client = await self._get_client()
        path = self._data_path(owner_type, owner_id, name)

        response = await client.get(f"/v1/{path}")
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            logger.error("Vault read failed: %s %s", response.status_code, response.text)
            return None

        body = response.json()
        return body.get("data", {}).get("data")

    async def get(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
    ) -> StoredCredential | None:
        raw = await self._read_raw(owner_type, owner_id, name)
        if raw is None:
            return None

        meta_str = raw.get("__meta__")
        if not meta_str:
            return None

        meta = json.loads(meta_str)
        return StoredCredential(
            id=meta["id"],
            name=name,
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
        raw = await self._read_raw(owner_type, owner_id, name)
        if raw is None:
            return None
        return {k: v for k, v in raw.items() if k != "__meta__"}

    async def delete(
        self,
        owner_type: str,
        owner_id: str,
        name: str,
    ) -> None:
        client = await self._get_client()
        path = self._data_path(owner_type, owner_id, name)
        response = await client.delete(f"/v1/{path}")
        if response.status_code >= 400 and response.status_code != 404:
            logger.error("Vault delete failed: %s %s", response.status_code, response.text)

    async def list(
        self,
        owner_type: str,
        owner_id: str,
        secret_type: SecretType | None = None,
    ) -> list[StoredCredential]:
        client = await self._get_client()
        list_path = self._list_path(owner_type, owner_id)

        response = await client.get(
            f"/v1/{list_path}",
            params={"list": "true"},
        )
        if response.status_code == 404:
            return []
        if response.status_code >= 400:
            logger.error("Vault list failed: %s %s", response.status_code, response.text)
            return []

        body = response.json()
        keys = body.get("data", {}).get("keys", [])

        results: list[StoredCredential] = []
        for key in keys:
            name = key.rstrip("/")
            cred = await self.get(owner_type, owner_id, name)
            if cred is None:
                continue
            if secret_type is not None and cred.secret_type != secret_type:
                continue
            results.append(cred)

        return sorted(results, key=lambda c: c.name)

    async def health_check(self) -> bool:
        try:
            client = await self._get_client()
            response = await client.get("/v1/sys/health")
            return response.status_code < 400
        except Exception:
            logger.exception("Vault health check failed")
            return False
