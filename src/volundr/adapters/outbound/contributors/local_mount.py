"""Local mount contributor — hostPath volumes for local filesystem mounts."""

from __future__ import annotations

import logging
import os
from pathlib import PurePosixPath

from volundr.domain.models import LocalMountSource, PodSpecAdditions, Session
from volundr.domain.ports import SessionContext, SessionContribution, SessionContributor

logger = logging.getLogger(__name__)


class LocalMountContributor(SessionContributor):
    """Contributes hostPath volumes for local mount sources.

    Validates mount paths against allowed_prefixes and allow_root_mount
    config. Only activates when the session source is LocalMountSource.
    """

    def __init__(
        self,
        *,
        enabled: bool = False,
        allow_root_mount: bool = False,
        allowed_prefixes: list[str] | None = None,
        **_extra: object,
    ):
        self._enabled = enabled
        self._allow_root_mount = allow_root_mount
        self._allowed_prefixes = allowed_prefixes or []

    @property
    def name(self) -> str:
        return "local_mount"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        if not isinstance(session.source, LocalMountSource):
            return SessionContribution()

        if not self._enabled:
            logger.warning(
                "Local mounts disabled but session %s requested local_mount source",
                session.id,
            )
            return SessionContribution()

        volumes: list[dict] = []
        mounts: list[dict] = []
        for i, mapping in enumerate(session.source.paths):
            self._validate_host_path(mapping.host_path)

            vol_name = f"local-mount-{i}"
            volumes.append(
                {
                    "name": vol_name,
                    "hostPath": {"path": mapping.host_path, "type": "Directory"},
                }
            )
            mounts.append(
                {
                    "name": vol_name,
                    "mountPath": mapping.mount_path,
                    "readOnly": mapping.read_only,
                }
            )

        pod_spec = PodSpecAdditions(
            volumes=tuple(volumes),
            volume_mounts=tuple(mounts),
        )

        return SessionContribution(pod_spec=pod_spec)

    def _validate_host_path(self, host_path: str) -> None:
        """Validate a host path against security constraints.

        Raises:
            ValueError: If the path is not allowed.
        """
        resolved = str(PurePosixPath(os.path.normpath(host_path)))

        if resolved == "/":
            if not self._allow_root_mount:
                raise ValueError("Mounting root filesystem (/) requires allow_root_mount=true")
            return

        if not self._allowed_prefixes:
            return

        for prefix in self._allowed_prefixes:
            normalized_prefix = str(PurePosixPath(os.path.normpath(prefix)))
            if resolved == normalized_prefix or resolved.startswith(normalized_prefix + "/"):
                return

        raise ValueError(
            f"Host path '{host_path}' is not under any allowed prefix: {self._allowed_prefixes}"
        )
