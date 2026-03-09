"""In-memory SecretRepository adapter.

Used for development and testing when no OpenBao/Vault
instance is available.
"""

from __future__ import annotations

import json
import logging

from volundr.domain.models import SecretMountSpec
from volundr.domain.ports import SecretRepository

logger = logging.getLogger(__name__)


class InMemorySecretRepository(SecretRepository):
    """In-memory implementation of SecretRepository.

    Stores credentials in a plain dict keyed by path.
    Policies and K8s roles are tracked as sets for assertions
    in tests.
    """

    def __init__(self) -> None:
        self._store: dict[str, dict[str, str]] = {}
        self._policies: dict[str, str] = {}
        self._k8s_roles: dict[str, dict] = {}

    # ------------------------------------------------------------------
    # KV v2 CRUD
    # ------------------------------------------------------------------

    async def store_credential(
        self,
        path: str,
        data: dict[str, str],
    ) -> None:
        """Store a credential at the given path."""
        self._store[path] = dict(data)

    async def get_credential(
        self,
        path: str,
    ) -> dict | None:
        """Read a credential from the given path."""
        return self._store.get(path)

    async def delete_credential(self, path: str) -> bool:
        """Delete a credential at the given path."""
        if path not in self._store:
            return False
        del self._store[path]
        return True

    async def list_credentials(
        self,
        path_prefix: str,
    ) -> list[str]:
        """List credential keys under a path prefix."""
        prefix = path_prefix.rstrip("/") + "/"
        keys: set[str] = set()

        for stored_path in self._store:
            if not stored_path.startswith(prefix):
                continue

            remainder = stored_path[len(prefix):]
            slash_idx = remainder.find("/")
            if slash_idx == -1:
                keys.add(remainder)
            else:
                keys.add(remainder[: slash_idx + 1])

        return sorted(keys)

    # ------------------------------------------------------------------
    # User provisioning
    # ------------------------------------------------------------------

    async def provision_user(
        self,
        user_id: str,
        tenant_id: str,
    ) -> None:
        """Record policy and K8s auth role for a user."""
        policy_name = f"volundr-user-{user_id}"
        self._policies[policy_name] = tenant_id

        self._k8s_roles[policy_name] = {
            "bound_service_account_names": [
                f"volundr-session-user-{user_id}-*",
            ],
            "policies": [policy_name],
        }

        logger.debug(
            "Provisioned in-memory user %s (tenant %s)",
            user_id, tenant_id,
        )

    async def deprovision_user(self, user_id: str) -> None:
        """Remove policy and K8s auth role for a user."""
        policy_name = f"volundr-user-{user_id}"
        self._policies.pop(policy_name, None)
        self._k8s_roles.pop(policy_name, None)

        logger.debug(
            "Deprovisioned in-memory user %s", user_id,
        )

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

        logger.debug(
            "Created in-memory session secrets for %s "
            "(%d mounts)",
            session_id, len(mounts),
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

        await self.delete_credential(
            f"{session_path}/manifest",
        )

        logger.debug(
            "Deleted in-memory session secrets for %s",
            session_id,
        )
