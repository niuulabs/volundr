"""SubprocessSpawnAdapter — spawn Ravn daemon instances as local subprocesses.

Writes a tempfile config for each spawned instance, starts ``ravn daemon``,
then polls DiscoveryPort until the new peer registers or the timeout expires.

Used locally and on Pi — no Kubernetes required.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from pathlib import Path

from ravn.ports.spawn import SpawnConfig

logger = logging.getLogger(__name__)

_DEFAULT_SPAWN_TIMEOUT_S = 30.0
_POLL_INTERVAL_S = 0.5


class SubprocessSpawnAdapter:
    """Spawn Ravn daemon instances as local subprocesses.

    Args:
        discovery:        DiscoveryPort instance for polling peer registration.
        ravn_executable:  Path to the ``ravn`` executable (default: ``ravn``).
        spawn_timeout_s:  Seconds to wait for each peer to register.
    """

    def __init__(
        self,
        discovery: object,
        *,
        ravn_executable: str = "ravn",
        spawn_timeout_s: float = _DEFAULT_SPAWN_TIMEOUT_S,
    ) -> None:
        self._discovery = discovery
        self._ravn_executable = ravn_executable
        self._spawn_timeout_s = spawn_timeout_s
        # peer_id → (process, tempfile path)
        self._spawned: dict[str, tuple[asyncio.subprocess.Process, Path]] = {}

    async def spawn(self, count: int, config: SpawnConfig) -> list[str]:
        """Spawn *count* Ravn daemon subprocesses and return their peer_ids.

        For each instance a minimal YAML config is written to a tempfile.
        The subprocess is started with ``RAVN_CONFIG`` pointing at that file.
        We then poll DiscoveryPort until the new peer_id appears.

        Raises ``TimeoutError`` if registration does not complete in time.
        """
        peer_ids: list[str] = []
        for _ in range(count):
            peer_id = await self._spawn_one(config)
            peer_ids.append(peer_id)
        return peer_ids

    async def terminate(self, peer_id: str) -> None:
        """Gracefully terminate a single spawned instance."""
        entry = self._spawned.pop(peer_id, None)
        if entry is None:
            logger.warning("spawn: terminate called for unknown peer %s", peer_id)
            return
        proc, cfg_path = entry
        if proc.returncode is None:
            proc.terminate()
            try:
                await asyncio.wait_for(proc.wait(), timeout=5.0)
            except TimeoutError:
                proc.kill()
        try:
            cfg_path.unlink(missing_ok=True)
        except Exception as exc:
            logger.debug("spawn: failed to remove tempfile %s: %s", cfg_path, exc)
        logger.info("spawn: terminated peer %s", peer_id)

    async def terminate_all(self) -> None:
        """Terminate all instances this spawner created."""
        peer_ids = list(self._spawned)
        for peer_id in peer_ids:
            await self.terminate(peer_id)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _spawn_one(self, config: SpawnConfig) -> str:
        """Start one daemon subprocess, wait for registration, return peer_id."""
        cfg_path = self._write_config(config)
        env = {**os.environ, "RAVN_CONFIG": str(cfg_path), **config.env}

        proc = await asyncio.create_subprocess_exec(
            self._ravn_executable,
            "daemon",
            env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        logger.info("spawn: started subprocess pid=%s", proc.pid)

        # Poll DiscoveryPort for the new peer
        try:
            peer_id = await asyncio.wait_for(
                self._wait_for_new_peer(config),
                timeout=self._spawn_timeout_s,
            )
        except TimeoutError:
            proc.terminate()
            cfg_path.unlink(missing_ok=True)
            raise TimeoutError(
                f"Spawned Ravn daemon did not register within {self._spawn_timeout_s}s"
            )

        self._spawned[peer_id] = (proc, cfg_path)
        logger.info("spawn: peer %s registered (pid=%s)", peer_id, proc.pid)
        return peer_id

    async def _wait_for_new_peer(self, config: SpawnConfig) -> str:
        """Poll DiscoveryPort until a new peer with matching persona appears."""
        known: set[str] = set(getattr(self._discovery, "peers", lambda: {})().keys())
        while True:
            await asyncio.sleep(_POLL_INTERVAL_S)
            current: dict = getattr(self._discovery, "peers", lambda: {})()
            new_peers = {pid: p for pid, p in current.items() if pid not in known}
            for pid, peer in new_peers.items():
                if not config.persona or getattr(peer, "persona", "") == config.persona:
                    return pid

    def _write_config(self, config: SpawnConfig) -> Path:
        """Write a minimal YAML config for the spawned daemon to a tempfile."""
        cfg: dict = {
            "initiative": {
                "enabled": True,
                "max_concurrent_tasks": config.max_concurrent_tasks,
                "default_persona": config.persona,
            },
            "permission": {"mode": config.permission_mode},
        }
        if config.ttl_minutes is not None:
            cfg["cascade"] = {"ttl_minutes": config.ttl_minutes}

        fd, path_str = tempfile.mkstemp(prefix="ravn_spawn_", suffix=".yaml")
        path = Path(path_str)
        try:
            with os.fdopen(fd, "w") as fh:
                # Write minimal YAML via json (both are valid supersets of each other
                # for this simple dict — no complex types used)
                import yaml  # noqa: PLC0415

                yaml.dump(cfg, fh, default_flow_style=False)
        except ImportError:
            # Fallback: write JSON (ravn config loader accepts both)
            with open(path, "w") as fh:
                json.dump(cfg, fh)
        return path
