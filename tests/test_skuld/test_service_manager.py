"""Tests for the Skuld service manager."""

import json
from pathlib import Path

import pytest
import yaml

from skuld.service_manager import (
    ServiceCreateRequest,
    ServiceManager,
)


@pytest.fixture
def workspace_dir(tmp_path: Path) -> Path:
    """Create a temporary workspace directory."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    return workspace


@pytest.fixture
async def service_manager(workspace_dir: Path) -> ServiceManager:
    """Create an initialized service manager."""
    manager = ServiceManager(str(workspace_dir))
    await manager.init()
    return manager


class TestServiceManagerInit:
    """Tests for service manager initialization."""

    @pytest.mark.asyncio
    async def test_init_creates_directories(self, workspace_dir: Path) -> None:
        manager = ServiceManager(str(workspace_dir))
        await manager.init()

        assert (workspace_dir / ".services").is_dir()
        assert (workspace_dir / ".services" / "logs").is_dir()
        assert (workspace_dir / ".services" / "status").is_dir()

    @pytest.mark.asyncio
    async def test_init_idempotent(self, workspace_dir: Path) -> None:
        manager = ServiceManager(str(workspace_dir))
        await manager.init()
        await manager.init()

        assert (workspace_dir / ".services").is_dir()


class TestAddService:
    """Tests for adding services."""

    @pytest.mark.asyncio
    async def test_add_service_writes_config(
        self, service_manager: ServiceManager, workspace_dir: Path
    ) -> None:
        request = ServiceCreateRequest(
            name="api",
            command="uvicorn main:app --port 9001",
            port=9001,
        )
        result = await service_manager.add_service(request)

        assert result.name == "api"
        assert result.status == "starting"
        assert result.port == 9001

        config_path = workspace_dir / ".services" / "config.yaml"
        assert config_path.exists()

        config = yaml.safe_load(config_path.read_text())
        assert "api" in config["services"]
        assert config["services"]["api"]["port"] == 9001
        assert config["services"]["api"]["command"] == "uvicorn main:app --port 9001"

    @pytest.mark.asyncio
    async def test_add_service_default_path(self, service_manager: ServiceManager) -> None:
        request = ServiceCreateRequest(
            name="myapi",
            command="python app.py",
            port=9002,
        )
        result = await service_manager.add_service(request)

        assert result.path == "/svc/myapi"

    @pytest.mark.asyncio
    async def test_add_service_custom_path(self, service_manager: ServiceManager) -> None:
        request = ServiceCreateRequest(
            name="api",
            command="python app.py",
            port=9001,
            path="/svc/backend",
        )
        result = await service_manager.add_service(request)

        assert result.path == "/svc/backend"

    @pytest.mark.asyncio
    async def test_add_service_normalizes_path(self, service_manager: ServiceManager) -> None:
        request = ServiceCreateRequest(
            name="api",
            command="python app.py",
            port=9001,
            path="backend",
        )
        result = await service_manager.add_service(request)

        assert result.path == "/svc/backend"

    @pytest.mark.asyncio
    async def test_add_multiple_services(
        self, service_manager: ServiceManager, workspace_dir: Path
    ) -> None:
        await service_manager.add_service(
            ServiceCreateRequest(name="api", command="uvicorn app:app", port=9001)
        )
        await service_manager.add_service(
            ServiceCreateRequest(name="frontend", command="npm run dev", port=9002)
        )

        config_path = workspace_dir / ".services" / "config.yaml"
        config = yaml.safe_load(config_path.read_text())

        assert "api" in config["services"]
        assert "frontend" in config["services"]
        assert config["services"]["api"]["port"] == 9001
        assert config["services"]["frontend"]["port"] == 9002


class TestRemoveService:
    """Tests for removing services."""

    @pytest.mark.asyncio
    async def test_remove_existing_service(
        self, service_manager: ServiceManager, workspace_dir: Path
    ) -> None:
        await service_manager.add_service(
            ServiceCreateRequest(name="api", command="python app.py", port=9001)
        )

        result = await service_manager.remove_service("api")
        assert result is True

        config_path = workspace_dir / ".services" / "config.yaml"
        config = yaml.safe_load(config_path.read_text())
        assert "api" not in config.get("services", {})

    @pytest.mark.asyncio
    async def test_remove_nonexistent_service(self, service_manager: ServiceManager) -> None:
        result = await service_manager.remove_service("doesnotexist")
        assert result is False


class TestListServices:
    """Tests for listing services."""

    @pytest.mark.asyncio
    async def test_list_empty(self, service_manager: ServiceManager) -> None:
        result = await service_manager.list_services()
        assert result == []

    @pytest.mark.asyncio
    async def test_list_with_services(self, service_manager: ServiceManager) -> None:
        await service_manager.add_service(
            ServiceCreateRequest(name="api", command="python app.py", port=9001)
        )
        await service_manager.add_service(
            ServiceCreateRequest(name="web", command="npm start", port=9002)
        )

        result = await service_manager.list_services()
        assert len(result) == 2

        names = {s.name for s in result}
        assert names == {"api", "web"}

    @pytest.mark.asyncio
    async def test_list_reads_status(
        self, service_manager: ServiceManager, workspace_dir: Path
    ) -> None:
        await service_manager.add_service(
            ServiceCreateRequest(name="api", command="python app.py", port=9001)
        )

        # Simulate devrunner writing status
        status_dir = workspace_dir / ".services" / "status"
        status_dir.mkdir(parents=True, exist_ok=True)
        (status_dir / "api.json").write_text(
            json.dumps({"status": "running", "pid": 12345, "started_at": 1000.0})
        )

        result = await service_manager.list_services()
        assert len(result) == 1
        assert result[0].status == "running"
        assert result[0].pid == 12345


class TestGetService:
    """Tests for getting a single service."""

    @pytest.mark.asyncio
    async def test_get_existing_service(self, service_manager: ServiceManager) -> None:
        await service_manager.add_service(
            ServiceCreateRequest(name="api", command="python app.py", port=9001)
        )

        result = await service_manager.get_service("api")
        assert result is not None
        assert result.name == "api"
        assert result.port == 9001

    @pytest.mark.asyncio
    async def test_get_nonexistent_service(self, service_manager: ServiceManager) -> None:
        result = await service_manager.get_service("nope")
        assert result is None


class TestGetLogs:
    """Tests for reading service logs."""

    @pytest.mark.asyncio
    async def test_get_logs_existing(
        self, service_manager: ServiceManager, workspace_dir: Path
    ) -> None:
        logs_dir = workspace_dir / ".services" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "api.log").write_text("line1\nline2\nline3\n")

        result = await service_manager.get_logs("api")
        assert result is not None
        assert "line1" in result
        assert "line3" in result

    @pytest.mark.asyncio
    async def test_get_logs_with_limit(
        self, service_manager: ServiceManager, workspace_dir: Path
    ) -> None:
        logs_dir = workspace_dir / ".services" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        (logs_dir / "api.log").write_text("line1\nline2\nline3\n")

        result = await service_manager.get_logs("api", lines=1)
        assert result is not None
        assert "line3" in result
        assert "line1" not in result

    @pytest.mark.asyncio
    async def test_get_logs_nonexistent(self, service_manager: ServiceManager) -> None:
        result = await service_manager.get_logs("nope")
        assert result is None


class TestRestartService:
    """Tests for restarting services."""

    @pytest.mark.asyncio
    async def test_restart_existing_service(
        self, service_manager: ServiceManager, workspace_dir: Path
    ) -> None:
        await service_manager.add_service(
            ServiceCreateRequest(name="api", command="python app.py", port=9001)
        )

        result = await service_manager.restart_service("api")
        assert result is not None
        assert result.status == "restarting"

        # Check that restart_requested_at was written
        config_path = workspace_dir / ".services" / "config.yaml"
        config = yaml.safe_load(config_path.read_text())
        assert "restart_requested_at" in config["services"]["api"]

    @pytest.mark.asyncio
    async def test_restart_nonexistent_service(self, service_manager: ServiceManager) -> None:
        result = await service_manager.restart_service("nope")
        assert result is None
