"""Storage contributor — wraps StoragePort for PVC provisioning."""

import asyncio
import logging
from typing import Any

from volundr.domain.models import Session, StorageQuota
from volundr.domain.ports import (
    SessionContext,
    SessionContribution,
    SessionContributor,
    StoragePort,
)

logger = logging.getLogger(__name__)


class StorageContributor(SessionContributor):
    """Provisions per-user home and per-session workspace PVCs."""

    def __init__(
        self,
        *,
        storage: StoragePort | None = None,
        **_extra: object,
    ):
        self._storage = storage

    @property
    def name(self) -> str:
        return "storage"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        if self._storage is None:
            return SessionContribution()

        home_pvc, workspace_pvc = await self._provision(session)

        values: dict[str, Any] = {}
        if home_pvc:
            values["homeVolume"] = {
                "existingClaim": home_pvc,
                "mountPath": self._storage.home_mount_path,
            }
        if workspace_pvc:
            values["persistence"] = {
                "existingClaim": workspace_pvc,
                "mountPath": self._storage.workspace_mount_path,
            }

        return SessionContribution(values=values)

    async def cleanup(
        self,
        session: Session,
        context: SessionContext,
    ) -> None:
        if self._storage is None:
            return
        await self._storage.archive_session_workspace(str(session.id))

    async def _provision(
        self,
        session: Session,
    ) -> tuple[str | None, str | None]:
        """Provision per-user home and per-session workspace PVCs."""
        # Check for existing workspace PVC (reuse if archived/active)
        existing_ws = await self._storage.get_workspace_by_session(str(session.id))
        if existing_ws is None and session.workspace_id is not None:
            # Try the explicitly requested workspace's session
            # workspace_id on Session is the session_id of the workspace to reuse
            pass

        if existing_ws:
            workspace_pvc = existing_ws.pvc_name
            logger.info(
                "Reusing workspace PVC %s for session %s",
                existing_ws.pvc_name,
                session.id,
            )
            if session.owner_id:
                home_ref = await self._storage.provision_user_storage(
                    session.owner_id,
                    StorageQuota(),
                )
                return (home_ref.name if home_ref else None, workspace_pvc)
            return (None, workspace_pvc)

        async def _create_workspace() -> str | None:
            ws_ref = await self._storage.create_session_workspace(
                str(session.id),
                session.owner_id or "",
                session.tenant_id or "",
            )
            return ws_ref.name if ws_ref else None

        async def _provision_home() -> str | None:
            if not session.owner_id:
                return None
            home_ref = await self._storage.provision_user_storage(
                session.owner_id,
                StorageQuota(),
            )
            return home_ref.name if home_ref else None

        workspace_pvc, home_pvc = await asyncio.gather(
            _create_workspace(),
            _provision_home(),
        )
        return (home_pvc, workspace_pvc)
