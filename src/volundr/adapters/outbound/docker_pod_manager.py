"""Docker Compose adapter for pod management.

Manages per-session Docker Compose stacks for local development.
Each session gets its own compose project with Skuld, code-server,
and ttyd containers on a shared Docker network.

Constructor accepts plain kwargs (dynamic adapter pattern):
    adapter: "volundr.adapters.outbound.docker_pod_manager.DockerPodManager"
    network: "volundr-net"
    skuld_image: "ghcr.io/niuulabs/skuld:latest"
    compose_dir: "~/.volundr/sessions"
    gateway_domain: "localhost:8443"
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from functools import partial
from pathlib import Path
from typing import Any

import yaml
from python_on_whales import DockerClient, DockerException

from volundr.domain.models import Session, SessionSpec, SessionStatus
from volundr.domain.ports import CredentialStorePort, PodManager, PodStartResult

logger = logging.getLogger(__name__)


class DockerPodManager(PodManager):
    """Docker Compose implementation of PodManager.

    Starts a per-session compose stack with Skuld, code-server, and ttyd
    containers. Suitable for local development and single-node deployments.

    Uses python-on-whales for typed Docker Compose interactions instead of
    raw subprocess calls.

    Constructor accepts plain kwargs (dynamic adapter pattern).
    """

    # Map Docker Compose container states to SessionStatus
    STATUS_MAP: dict[str, SessionStatus] = {
        "running": SessionStatus.RUNNING,
        "created": SessionStatus.STARTING,
        "restarting": SessionStatus.STARTING,
        "paused": SessionStatus.STOPPED,
        "exited": SessionStatus.STOPPED,
        "dead": SessionStatus.FAILED,
    }

    def __init__(
        self,
        *,
        network: str = "volundr-net",
        skuld_image: str = "ghcr.io/niuulabs/skuld:latest",
        code_server_image: str = "ghcr.io/niuulabs/code-server:latest",
        reh_image: str = "ghcr.io/niuulabs/vscode-reh:latest",
        ttyd_image: str = "ghcr.io/niuulabs/ttyd:latest",
        compose_dir: str = "~/.volundr/sessions",
        gateway_domain: str | None = None,
        db_host: str = "host.docker.internal",
        db_port: int = 5433,
        db_user: str = "volundr",
        db_password: str = "",
        db_name: str = "volundr",
        poll_interval: float = 2.0,
        **_extra: object,
    ):
        self._network = network
        self._skuld_image = skuld_image
        self._code_server_image = code_server_image
        self._reh_image = reh_image
        self._ttyd_image = ttyd_image
        self._compose_dir = Path(compose_dir).expanduser()
        self._gateway_domain = gateway_domain
        self._db_host = db_host
        self._db_port = db_port
        self._db_user = db_user
        self._db_password = db_password
        self._db_name = db_name
        self._poll_interval = poll_interval
        self._credential_store: CredentialStorePort | None = None

    # Keys from spec.values that are structured and should NOT be dumped
    # as flat environment variables.
    _STRUCTURED_KEYS: frozenset[str] = frozenset(
        {
            "envSecrets",
            "persistence",
            "homeVolume",
            "git",
            "mcpServers",
            "session",
            "env",
            "ingress",
            "resources",
            "podSpec",
            "pod_spec",
        }
    )

    def set_credential_store(self, store: CredentialStorePort) -> None:
        """Inject credential store for resolving envSecrets."""
        self._credential_store = store

    def _project_name(self, session: Session) -> str:
        return f"volundr-session-{session.id}"

    def _session_dir(self, session: Session) -> Path:
        return self._compose_dir / str(session.id)

    def _compose_file(self, session: Session) -> Path:
        return self._session_dir(session) / "docker-compose.yml"

    def _chat_endpoint(self, session: Session) -> str:
        if self._gateway_domain:
            return f"wss://{self._gateway_domain}/s/{session.id}/session"
        return f"http://{self._project_name(session)}-skuld-1:8080/session"

    def _code_endpoint(self, session: Session) -> str:
        if self._gateway_domain:
            return f"https://{self._gateway_domain}/s/{session.id}/"
        return f"http://{self._project_name(session)}-code-server-1:8080/"

    def _build_compose(
        self,
        session: Session,
        spec: SessionSpec,
        resolved_secrets: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """Build a Docker Compose definition for the session.

        Args:
            session: The session to build compose for.
            spec: Merged SessionSpec from the contributor pipeline.
            resolved_secrets: Pre-resolved env secrets (async resolution
                happens in start() before this sync method is called).
        """
        skuld_env: dict[str, str] = {
            "SESSION_ID": str(session.id),
            "SESSION_NAME": session.name,
            "DATABASE__HOST": self._db_host,
            "DATABASE__PORT": str(self._db_port),
            "DATABASE__USER": self._db_user,
            "DATABASE__PASSWORD": self._db_password,
            "DATABASE__NAME": self._db_name,
        }

        # Apply resolved secrets from envSecrets
        if resolved_secrets:
            skuld_env.update(resolved_secrets)

        # Handle git config
        git_config = spec.values.get("git", {})
        if git_config.get("cloneUrl"):
            skuld_env["GIT_CLONE_URL"] = git_config["cloneUrl"]
        if git_config.get("branch"):
            skuld_env["GIT_BRANCH"] = git_config["branch"]

        # Handle MCP servers as JSON env var
        mcp_servers = spec.values.get("mcpServers", [])
        if mcp_servers:
            skuld_env["MCP_SERVERS"] = json.dumps(mcp_servers)

        # Handle session metadata
        session_config = spec.values.get("session", {})
        if session_config.get("model"):
            skuld_env["SESSION_MODEL"] = session_config["model"]

        # Handle extra env passthrough
        extra_env = spec.values.get("env", {})
        if isinstance(extra_env, dict):
            for k, v in extra_env.items():
                skuld_env[k] = str(v)

        # Pass through any non-structured values as flat env vars
        for key, value in spec.values.items():
            if key in self._STRUCTURED_KEYS:
                continue
            skuld_env[key] = str(value)

        # Build bind-mount volumes from persistence and homeVolume
        volumes = self._build_volumes(spec)

        compose: dict[str, Any] = {
            "services": {
                "skuld": {
                    "image": self._skuld_image,
                    "networks": [self._network],
                    "environment": skuld_env,
                    "volumes": volumes,
                },
                "code-server": {
                    "image": self._code_server_image,
                    "networks": [self._network],
                    "volumes": volumes,
                },
                "vscode-reh": {
                    "image": self._reh_image,
                    "networks": [self._network],
                    "volumes": volumes,
                },
                "ttyd": {
                    "image": self._ttyd_image,
                    "networks": [self._network],
                },
            },
            "networks": {
                self._network: {
                    "external": True,
                },
            },
        }

        # Only add named volumes section when using the default workspace volume
        if volumes == ["workspace:/workspace"]:
            compose["volumes"] = {"workspace": {}}

        return compose

    @staticmethod
    def _build_volumes(spec: SessionSpec) -> list[str]:
        """Build volume bind mounts from persistence and homeVolume config."""
        persistence = spec.values.get("persistence", {})
        home_volume = spec.values.get("homeVolume", {})

        volumes: list[str] = []
        if persistence.get("existingClaim"):
            host_path = persistence["existingClaim"]
            mount_path = persistence.get("mountPath", "/volundr/sessions")
            volumes.append(f"{host_path}:{mount_path}")
        if home_volume.get("existingClaim"):
            host_path = home_volume["existingClaim"]
            mount_path = home_volume.get("mountPath", "/volundr/home")
            volumes.append(f"{host_path}:{mount_path}")

        # Fall back to default named volume when no bind mounts configured
        if not volumes:
            volumes.append("workspace:/workspace")

        return volumes

    def _docker_client(self, session: Session) -> DockerClient:
        """Create a DockerClient scoped to the session's compose project."""
        return DockerClient(
            compose_files=[self._compose_file(session)],
            compose_project_name=self._project_name(session),
        )

    async def _run_in_executor(self, func, *args, **kwargs):
        """Run a synchronous function in a thread executor."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, partial(func, *args, **kwargs))

    async def _resolve_env_secrets(
        self,
        session: Session,
        spec: SessionSpec,
    ) -> dict[str, str]:
        """Resolve envSecrets entries via the credential store.

        Returns a dict of env-var-name -> secret-value for all successfully
        resolved secrets. Skips silently when no credential store is set.
        """
        env_secrets = spec.values.get("envSecrets", [])
        if not env_secrets:
            return {}

        if not self._credential_store:
            logger.debug(
                "envSecrets present but no credential store configured for session %s",
                session.id,
            )
            return {}

        resolved: dict[str, str] = {}
        owner_id = str(session.owner_id) if session.owner_id else ""
        for entry in env_secrets:
            secret_name = entry.get("secretName", "")
            secret_key = entry.get("secretKey", "")
            env_var = entry.get("envVar", "")
            if not (secret_name and secret_key and env_var):
                continue

            cred_data = await self._credential_store.get_value(
                "user",
                owner_id,
                secret_name,
            )
            if not cred_data:
                logger.warning(
                    "Secret not found for session %s",
                    session.id,
                )
                continue
            if secret_key not in cred_data:
                logger.warning(
                    "Key %r not found in secret %r for session %s",
                    secret_key,
                    secret_name,
                    session.id,
                )
                continue
            resolved[env_var] = cred_data[secret_key]

        return resolved

    async def start(
        self,
        session: Session,
        spec: SessionSpec,
    ) -> PodStartResult:
        """Start a Docker Compose stack for the session."""
        session_dir = self._session_dir(session)
        session_dir.mkdir(parents=True, exist_ok=True)

        # Resolve async secrets before building the sync compose dict
        resolved_secrets = await self._resolve_env_secrets(session, spec)
        compose_def = self._build_compose(session, spec, resolved_secrets=resolved_secrets)
        compose_path = self._compose_file(session)
        compose_path.write_text(yaml.dump(compose_def, default_flow_style=False))
        logger.info(
            "Wrote compose file for session %s at %s",
            session.id,
            compose_path,
        )

        client = self._docker_client(session)
        try:
            await self._run_in_executor(client.compose.up, detach=True)
        except DockerException as exc:
            logger.error("Failed to start session %s: %s", session.id, exc)
            raise RuntimeError(f"docker compose up failed: {exc}") from exc

        logger.info("Started Docker Compose stack for session %s", session.id)
        return PodStartResult(
            chat_endpoint=self._chat_endpoint(session),
            code_endpoint=self._code_endpoint(session),
            pod_name=self._project_name(session),
        )

    async def stop(self, session: Session) -> bool:
        """Stop and remove the Docker Compose stack for the session."""
        compose_path = self._compose_file(session)
        if not compose_path.exists():
            logger.warning(
                "No compose file found for session %s, nothing to stop",
                session.id,
            )
            return True

        client = self._docker_client(session)
        try:
            await self._run_in_executor(client.compose.down)
        except DockerException as exc:
            logger.error("Failed to stop session %s: %s", session.id, exc)
            return False

        # Clean up compose directory
        session_dir = self._session_dir(session)
        shutil.rmtree(session_dir, ignore_errors=True)
        logger.info("Stopped and cleaned up session %s", session.id)
        return True

    async def status(self, session: Session) -> SessionStatus:
        """Get the current status of the session's containers."""
        compose_path = self._compose_file(session)
        if not compose_path.exists():
            return SessionStatus.STOPPED

        client = self._docker_client(session)
        try:
            containers = await self._run_in_executor(client.compose.ps)
        except DockerException:
            return SessionStatus.STOPPED

        if not containers:
            return SessionStatus.STOPPED

        return self._aggregate_status(containers)

    @classmethod
    def _aggregate_status(cls, containers: list) -> SessionStatus:
        """Aggregate container states into a single SessionStatus.

        Accepts python-on-whales Container objects. Each container has a
        .state.status attribute with values like "running", "exited", etc.

        If any container is dead/failed, the session is FAILED.
        If all containers are running, the session is RUNNING.
        Otherwise map from the most representative state.
        """
        states = [c.state.status for c in containers]

        if any(s in ("dead",) for s in states):
            return SessionStatus.FAILED

        if all(s == "running" for s in states):
            return SessionStatus.RUNNING

        if any(s in ("exited", "paused") for s in states):
            return SessionStatus.STOPPED

        # Default: map the first container's state
        return cls.STATUS_MAP.get(states[0], SessionStatus.STARTING)

    async def wait_for_ready(
        self,
        session: Session,
        timeout: float,
    ) -> SessionStatus:
        """Poll status until RUNNING or FAILED/timeout."""
        elapsed = 0.0
        while elapsed < timeout:
            current = await self.status(session)
            if current == SessionStatus.RUNNING:
                return SessionStatus.RUNNING
            if current == SessionStatus.FAILED:
                return SessionStatus.FAILED
            await asyncio.sleep(self._poll_interval)
            elapsed += self._poll_interval

        logger.warning("Timed out waiting for session %s after %.1fs", session.id, timeout)
        return SessionStatus.FAILED
