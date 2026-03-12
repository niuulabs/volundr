"""Local filesystem storage adapter for Docker-based runtime."""

from __future__ import annotations

import datetime
import json
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

from volundr.domain.models import PVCRef, StorageQuota, WorkspaceStatus
from volundr.domain.ports import StoragePort

logger = logging.getLogger(__name__)

_META_FILENAME = ".volundr-meta.json"


@dataclass
class _WorkspaceEntry:
    """Internal tracking for a local workspace."""

    pvc_ref: PVCRef
    session_id: str
    user_id: str
    tenant_id: str
    size_gb: int
    status: WorkspaceStatus
    created_at: datetime.datetime


class LocalStorageAdapter(StoragePort):
    """Storage adapter that uses local filesystem directories.

    Workspace directory: ``{base_dir}/workspaces/{session_id}/``
    Home directory:      ``{base_dir}/home/{user_id}/``

    ``PVCRef.name`` contains the absolute host path so that
    ``DockerPodManager`` can interpret it as a bind-mount source.
    ``PVCRef.namespace`` is set to ``"local"`` as a sentinel value.
    """

    def __init__(
        self,
        *,
        base_dir: str = "~/.volundr/storage",
        **_extra: object,
    ) -> None:
        self._base = Path(base_dir).expanduser().resolve()
        self._workspaces_dir = self._base / "workspaces"
        self._home_dir = self._base / "home"

        self._user_pvcs: dict[str, PVCRef] = {}
        self._session_workspaces: dict[str, _WorkspaceEntry] = {}

        self._scan_existing()

    # ------------------------------------------------------------------
    # StoragePort implementation
    # ------------------------------------------------------------------

    async def provision_user_storage(
        self,
        user_id: str,
        quota: StorageQuota,
    ) -> PVCRef:
        """Create (or return existing) home directory for a user."""
        existing = self._user_pvcs.get(user_id)
        if existing:
            return existing

        user_home = self._home_dir / user_id
        user_home.mkdir(parents=True, exist_ok=True)
        ref = PVCRef(name=str(user_home), namespace="local")
        self._user_pvcs[user_id] = ref
        logger.info("Provisioned local home storage for user %s at %s", user_id, user_home)
        return ref

    async def create_session_workspace(
        self,
        session_id: str,
        user_id: str = "",
        tenant_id: str = "",
        workspace_gb: int = 50,
    ) -> PVCRef:
        """Create a workspace directory for a session."""
        ws_path = self._workspaces_dir / session_id
        ws_path.mkdir(parents=True, exist_ok=True)

        now = datetime.datetime.now(datetime.UTC)
        ref = PVCRef(name=str(ws_path), namespace="local")
        entry = _WorkspaceEntry(
            pvc_ref=ref,
            session_id=session_id,
            user_id=user_id,
            tenant_id=tenant_id,
            size_gb=workspace_gb,
            status=WorkspaceStatus.ACTIVE,
            created_at=now,
        )
        self._session_workspaces[session_id] = entry
        self._write_meta(ws_path, entry)
        logger.info("Created local workspace for session %s at %s", session_id, ws_path)
        return ref

    async def archive_session_workspace(
        self,
        session_id: str,
    ) -> None:
        """Mark a session workspace as archived."""
        entry = self._session_workspaces.get(session_id)
        if not entry:
            logger.warning("Cannot archive unknown workspace for session %s", session_id)
            return

        entry.status = WorkspaceStatus.ARCHIVED
        ws_path = self._workspaces_dir / session_id
        self._write_meta(ws_path, entry)
        logger.info("Archived workspace for session %s", session_id)

    async def delete_workspace(
        self,
        session_id: str,
    ) -> None:
        """Permanently delete a session workspace directory."""
        self._session_workspaces.pop(session_id, None)
        ws_path = self._workspaces_dir / session_id
        if ws_path.exists():
            shutil.rmtree(ws_path)
        logger.info("Deleted workspace for session %s", session_id)

    async def get_user_storage_usage(
        self,
        user_id: str,
    ) -> int:
        """Get total storage in GB currently tracked for a user."""
        total = 0
        for entry in self._session_workspaces.values():
            if entry.user_id == user_id:
                total += entry.size_gb
        return total

    async def deprovision_user_storage(
        self,
        user_id: str,
    ) -> None:
        """Remove a user's home directory."""
        self._user_pvcs.pop(user_id, None)
        user_home = self._home_dir / user_id
        if user_home.exists():
            shutil.rmtree(user_home)
        logger.info("Deprovisioned home storage for user %s", user_id)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _write_meta(self, ws_path: Path, entry: _WorkspaceEntry) -> None:
        """Write workspace metadata to a sidecar JSON file."""
        meta = {
            "session_id": entry.session_id,
            "user_id": entry.user_id,
            "tenant_id": entry.tenant_id,
            "status": entry.status.value,
            "size_gb": entry.size_gb,
            "created_at": entry.created_at.isoformat(),
        }
        meta_path = ws_path / _META_FILENAME
        meta_path.write_text(json.dumps(meta, indent=2))

    def _scan_existing(self) -> None:
        """Reconstruct tracking state from existing directories and meta files."""
        if not self._workspaces_dir.exists():
            return

        for child in self._workspaces_dir.iterdir():
            if not child.is_dir():
                continue

            meta_path = child / _META_FILENAME
            if not meta_path.exists():
                continue

            try:
                meta = json.loads(meta_path.read_text())
            except (json.JSONDecodeError, OSError):
                logger.warning("Skipping corrupt meta file at %s", meta_path)
                continue

            session_id = meta.get("session_id", child.name)
            ref = PVCRef(name=str(child), namespace="local")
            self._session_workspaces[session_id] = _WorkspaceEntry(
                pvc_ref=ref,
                session_id=session_id,
                user_id=meta.get("user_id", ""),
                tenant_id=meta.get("tenant_id", ""),
                size_gb=meta.get("size_gb", 0),
                status=WorkspaceStatus(meta.get("status", "active")),
                created_at=datetime.datetime.fromisoformat(meta["created_at"]),
            )

        # Scan home dirs to reconstruct user PVC refs
        if not self._home_dir.exists():
            return

        for child in self._home_dir.iterdir():
            if not child.is_dir():
                continue
            self._user_pvcs[child.name] = PVCRef(name=str(child), namespace="local")
