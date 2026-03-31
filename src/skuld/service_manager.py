"""Service manager - writes config for devrunner, reads status and logs."""

import json
import logging
import time
from dataclasses import field
from pathlib import Path

import yaml
from pydantic import BaseModel

logger = logging.getLogger("skuld.service_manager")


class ServiceCreateRequest(BaseModel):
    """Request to create a service."""

    name: str
    command: str
    port: int
    cwd: str = ""
    path: str = ""
    env: dict[str, str] = field(default_factory=dict)
    restart_policy: str = "on-failure"
    max_restarts: int = 5


class ServiceStatus(BaseModel):
    """Service status response."""

    name: str
    status: str
    port: int
    command: str
    path: str = ""
    pid: int | None = None
    started_at: float | None = None
    restart_count: int = 0
    exit_code: int | None = None


class ServiceManager:
    """Manages service definitions - writes config.yaml, devrunner executes.

    The broker owns this class and uses it to modify the shared config file.
    The devrunner container watches the config file and starts/stops services.
    """

    def __init__(self, workspace_dir: str):
        self.workspace_dir = Path(workspace_dir)
        self.services_dir = self.workspace_dir / ".services"
        self.config_path = self.services_dir / "config.yaml"
        self.logs_dir = self.services_dir / "logs"
        self.status_dir = self.services_dir / "status"

    async def init(self) -> None:
        """Ensure directories exist."""
        self.services_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(exist_ok=True)
        self.status_dir.mkdir(exist_ok=True)

    async def add_service(self, request: ServiceCreateRequest) -> ServiceStatus:
        """Add a service to config (devrunner will start it)."""
        config = self._load_config()
        services = config.setdefault("services", {})

        path = request.path or f"/svc/{request.name}"
        if not path.startswith("/svc/"):
            path = f"/svc/{path.lstrip('/')}"

        services[request.name] = {
            "command": request.command,
            "port": request.port,
            "cwd": request.cwd or str(self.workspace_dir),
            "path": path,
            "env": request.env if isinstance(request.env, dict) else {},
            "restart_policy": request.restart_policy,
            "max_restarts": request.max_restarts,
            "created_at": time.time(),
        }

        self._save_config(config)
        logger.info(f"Added service: {request.name} on port {request.port}")

        return ServiceStatus(
            name=request.name,
            status="starting",
            port=request.port,
            command=request.command,
            path=path,
        )

    async def remove_service(self, name: str) -> bool:
        """Remove service from config (devrunner will stop it)."""
        config = self._load_config()
        services = config.get("services", {})

        if name not in services:
            return False

        del services[name]
        self._save_config(config)
        logger.info(f"Removed service: {name}")
        return True

    async def list_services(self) -> list[ServiceStatus]:
        """List all services with status from devrunner."""
        config = self._load_config()
        services = config.get("services", {})
        result = []

        for name, svc in services.items():
            status_data = self._read_status(name)
            result.append(
                ServiceStatus(
                    name=name,
                    status=status_data.get("status", "unknown"),
                    port=svc["port"],
                    command=svc["command"],
                    path=svc.get("path", f"/svc/{name}"),
                    pid=status_data.get("pid"),
                    started_at=status_data.get("started_at"),
                    restart_count=status_data.get("restart_count", 0),
                    exit_code=status_data.get("exit_code"),
                )
            )

        return result

    async def get_service(self, name: str) -> ServiceStatus | None:
        """Get a single service status."""
        config = self._load_config()
        services = config.get("services", {})

        if name not in services:
            return None

        svc = services[name]
        status_data = self._read_status(name)

        return ServiceStatus(
            name=name,
            status=status_data.get("status", "unknown"),
            port=svc["port"],
            command=svc["command"],
            path=svc.get("path", f"/svc/{name}"),
            pid=status_data.get("pid"),
            started_at=status_data.get("started_at"),
            restart_count=status_data.get("restart_count", 0),
            exit_code=status_data.get("exit_code"),
        )

    async def get_logs(self, name: str, lines: int = 100) -> str | None:
        """Read last N lines of a service's log file."""
        log_path = self.logs_dir / f"{name}.log"
        if not log_path.exists():
            return None

        try:
            with open(log_path) as f:
                all_lines = f.readlines()
                return "".join(all_lines[-lines:])
        except Exception:
            logger.exception(f"Error reading logs for {name}")
            return None

    async def restart_service(self, name: str) -> ServiceStatus | None:
        """Restart a service by removing and re-adding it."""
        config = self._load_config()
        services = config.get("services", {})

        if name not in services:
            return None

        svc = services[name]
        # Bump a restart_requested timestamp to trigger devrunner reconcile
        svc["restart_requested_at"] = time.time()
        self._save_config(config)

        return ServiceStatus(
            name=name,
            status="restarting",
            port=svc["port"],
            command=svc["command"],
            path=svc.get("path", f"/svc/{name}"),
        )

    def _load_config(self) -> dict:
        """Load config.yaml."""
        if not self.config_path.exists():
            return {}

        try:
            with open(self.config_path) as f:
                return yaml.safe_load(f) or {}
        except Exception:
            logger.exception("Error loading config.yaml")
            return {}

    def _save_config(self, config: dict) -> None:
        """Save config.yaml."""
        self.services_dir.mkdir(parents=True, exist_ok=True)
        with open(self.config_path, "w") as f:
            yaml.dump(config, f, default_flow_style=False)

    def _read_status(self, name: str) -> dict:
        """Read service status from devrunner's status directory."""
        status_file = self.status_dir / f"{name}.json"
        if not status_file.exists():
            return {"status": "unknown"}

        try:
            return json.loads(status_file.read_text())
        except Exception:
            return {"status": "unknown"}
