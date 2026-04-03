"""Tests for cli.server — Root ASGI server, SkuldPortRegistry, and proxies."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from cli.registry import PluginRegistry
from cli.server import (
    _PLUGIN_API_PREFIXES,
    RootServer,
    SkuldPortRegistry,
    _PrefixRestoreApp,
    get_skuld_registry,
)
from niuu.ports.embedded_database import ConnectionInfo
from tests.test_cli.conftest import FakePlugin


class TestSkuldPortRegistry:
    """Tests for SkuldPortRegistry register/unregister/get_port."""

    def test_register_and_get_port(self) -> None:
        reg = SkuldPortRegistry()
        reg.register("sess-1", 9100)
        assert reg.get_port("sess-1") == 9100

    def test_unregister(self) -> None:
        reg = SkuldPortRegistry()
        reg.register("sess-1", 9100)
        reg.unregister("sess-1")
        assert reg.get_port("sess-1") is None

    def test_unregister_nonexistent(self) -> None:
        reg = SkuldPortRegistry()
        reg.unregister("does-not-exist")  # should not raise

    def test_get_port_unknown(self) -> None:
        reg = SkuldPortRegistry()
        assert reg.get_port("unknown") is None

    def test_register_overwrites(self) -> None:
        reg = SkuldPortRegistry()
        reg.register("sess-1", 9100)
        reg.register("sess-1", 9200)
        assert reg.get_port("sess-1") == 9200


class TestGetSkuldRegistry:
    """Tests for the module-level get_skuld_registry function."""

    def test_returns_registry_after_rootserver_init(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        result = get_skuld_registry()
        assert result is server.skuld_registry
        assert isinstance(result, SkuldPortRegistry)


class TestPrefixRestoreApp:
    """Tests for _PrefixRestoreApp ASGI wrapper."""

    @pytest.mark.asyncio
    async def test_restores_http_path_prefix(self) -> None:
        received_scope: dict = {}

        async def fake_app(scope, receive, send):
            received_scope.update(scope)

        wrapper = _PrefixRestoreApp(fake_app, "/api/v1/volundr")
        scope = {
            "type": "http",
            "path": "/sessions",
            "raw_path": b"/sessions",
        }
        await wrapper(scope, AsyncMock(), AsyncMock())
        assert received_scope["path"] == "/api/v1/volundr/sessions"
        assert received_scope["raw_path"] == b"/api/v1/volundr/sessions"

    @pytest.mark.asyncio
    async def test_restores_websocket_path_prefix(self) -> None:
        received_scope: dict = {}

        async def fake_app(scope, receive, send):
            received_scope.update(scope)

        wrapper = _PrefixRestoreApp(fake_app, "/api/v1/tyr")
        scope = {
            "type": "websocket",
            "path": "/ws",
            "raw_path": b"/ws",
        }
        await wrapper(scope, AsyncMock(), AsyncMock())
        assert received_scope["path"] == "/api/v1/tyr/ws"

    @pytest.mark.asyncio
    async def test_passes_lifespan_unchanged(self) -> None:
        received_scope: dict = {}

        async def fake_app(scope, receive, send):
            received_scope.update(scope)

        wrapper = _PrefixRestoreApp(fake_app, "/api/v1/volundr")
        scope = {"type": "lifespan", "path": "/something"}
        await wrapper(scope, AsyncMock(), AsyncMock())
        # lifespan should not be modified
        assert received_scope["path"] == "/something"

    @pytest.mark.asyncio
    async def test_handles_missing_raw_path(self) -> None:
        received_scope: dict = {}

        async def fake_app(scope, receive, send):
            received_scope.update(scope)

        wrapper = _PrefixRestoreApp(fake_app, "/api/v1/volundr")
        scope = {"type": "http", "path": "/sessions"}
        await wrapper(scope, AsyncMock(), AsyncMock())
        assert received_scope["path"] == "/api/v1/volundr/sessions"
        assert "raw_path" not in received_scope or received_scope.get("raw_path") is None


class TestRootServerInit:
    """Tests for RootServer constructor."""

    def test_default_host_and_port(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        assert server._host == "127.0.0.1"
        assert server._port == 8080

    def test_custom_host_and_port(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry, host="0.0.0.0", port=9090)
        assert server._host == "0.0.0.0"
        assert server._port == 9090

    def test_skuld_registry_initialized(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        assert isinstance(server.skuld_registry, SkuldPortRegistry)


class TestRootServerBuildApp:
    """Tests for RootServer._build_app()."""

    def test_build_app_returns_fastapi(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        assert isinstance(app, FastAPI)

    def test_health_endpoint(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        client = TestClient(app)
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_config_json_endpoint(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry, host="127.0.0.1", port=8080)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        client = TestClient(app)
        resp = client.get("/config.json")
        assert resp.status_code == 200
        assert resp.json()["apiBaseUrl"] == "http://127.0.0.1:8080"

    def test_skuld_http_proxy_session_not_found(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        client = TestClient(app)
        resp = client.get("/s/nonexistent/api/some/path")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Session not found"

    def test_skuld_health_proxy_session_not_found(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        client = TestClient(app)
        resp = client.get("/s/nonexistent/health")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Session not found"

    def test_skuld_http_proxy_forwards_request(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        server.skuld_registry.register("sess-1", 9100)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        client = TestClient(app)

        mock_response = MagicMock()
        mock_response.content = b'{"ok": true}'
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "application/json"}

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client
            resp = client.get("/s/sess-1/api/data")

        assert resp.status_code == 200

    def test_skuld_http_proxy_connect_error(self) -> None:
        import httpx

        registry = PluginRegistry()
        server = RootServer(registry=registry)
        server.skuld_registry.register("sess-1", 9100)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        client = TestClient(app)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client
            resp = client.get("/s/sess-1/api/data")

        assert resp.status_code == 502
        assert "not ready" in resp.json()["detail"].lower()

    def test_skuld_health_proxy_forwards_when_registered(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        server.skuld_registry.register("sess-1", 9100)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        client = TestClient(app)

        mock_response = MagicMock()
        mock_response.content = b'{"status": "ok"}'
        mock_response.status_code = 200
        mock_response.headers = {"content-type": "application/json"}

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client
            resp = client.get("/s/sess-1/health")

        assert resp.status_code == 200

    def test_skuld_health_proxy_connect_error(self) -> None:
        import httpx

        registry = PluginRegistry()
        server = RootServer(registry=registry)
        server.skuld_registry.register("sess-1", 9100)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        client = TestClient(app)

        with patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client
            resp = client.get("/s/sess-1/health")

        assert resp.status_code == 502

    def test_no_web_skips_static_files(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        client = TestClient(app, raise_server_exceptions=False)
        # Without web UI, there should be no SPA fallback
        resp = client.get("/some-random-page")
        assert resp.status_code in (404, 405)

    def test_web_ui_with_dist_directory(self, tmp_path: Path) -> None:
        """When web dist dir exists, SPA fallback is mounted."""
        dist = tmp_path / "dist"
        dist.mkdir()
        assets = dist / "assets"
        assets.mkdir()
        (assets / "main.js").write_text("// js")
        (dist / "index.html").write_text("<html>SPA</html>")
        favicon = dist / "favicon.svg"
        favicon.write_text("<svg/>")

        registry = PluginRegistry()
        server = RootServer(registry=registry)

        with (
            patch.dict(os.environ, {}, clear=False),
            patch("cli.resources.web_dist_dir", return_value=dist),
        ):
            # Remove NIUU_NO_WEB if set
            os.environ.pop("NIUU_NO_WEB", None)
            app = server._build_app()

        client = TestClient(app)
        # SPA fallback should serve index.html for unknown routes
        resp = client.get("/dashboard")
        assert resp.status_code == 200
        assert b"SPA" in resp.content

    def test_web_ui_filenotfound_gracefully_handled(self) -> None:
        """When web_dist_dir raises FileNotFoundError, app is still returned."""
        registry = PluginRegistry()
        server = RootServer(registry=registry)

        with (
            patch.dict(os.environ, {}, clear=False),
            patch("cli.resources.web_dist_dir", side_effect=FileNotFoundError("no dist")),
        ):
            os.environ.pop("NIUU_NO_WEB", None)
            app = server._build_app()

        assert isinstance(app, FastAPI)

    def test_mounts_plugin_sub_apps(self) -> None:
        """Plugin sub-apps are mounted at their API prefixes."""
        sub_app = FastAPI()

        @sub_app.get("/api/v1/volundr/ping")
        async def ping():
            return {"pong": True}

        class VolundrPlugin(FakePlugin):
            def create_api_app(self):
                return sub_app

        registry = PluginRegistry()
        registry.register(VolundrPlugin(name="volundr"))

        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()

        client = TestClient(app)
        resp = client.get("/api/v1/volundr/ping")
        assert resp.status_code == 200
        assert resp.json() == {"pong": True}

    def test_plugin_create_api_app_returns_none(self) -> None:
        """Plugin that returns None from create_api_app is skipped."""
        registry = PluginRegistry()
        registry.register(FakePlugin(name="volundr"))

        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()

        assert isinstance(app, FastAPI)

    def test_plugin_create_api_app_exception(self) -> None:
        """Plugin that raises in create_api_app is skipped gracefully."""

        class BrokenPlugin(FakePlugin):
            def create_api_app(self):
                raise RuntimeError("Broken")

        registry = PluginRegistry()
        registry.register(BrokenPlugin(name="volundr"))

        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()

        assert isinstance(app, FastAPI)


class TestRootServerStartStop:
    """Tests for RootServer.start() and stop()."""

    @pytest.mark.asyncio
    async def test_start_calls_embedded_db_and_build_app(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)

        # Mock the internal methods
        server._start_embedded_db = AsyncMock()
        server._run_migrations = AsyncMock()

        mock_uvicorn_server = MagicMock()
        mock_uvicorn_server.serve = AsyncMock()

        with (
            patch.dict(os.environ, {"NIUU_NO_WEB": "true"}),
            patch("uvicorn.Server", return_value=mock_uvicorn_server),
            patch("uvicorn.Config"),
        ):
            await server.start()

        server._start_embedded_db.assert_awaited_once()
        server._run_migrations.assert_awaited_once()
        assert server._server is mock_uvicorn_server

    @pytest.mark.asyncio
    async def test_stop_shuts_down_server_and_db(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)

        mock_uvicorn_server = MagicMock()
        mock_db = AsyncMock()

        # Create a real completed task
        async def _noop():
            pass
        loop = asyncio.get_event_loop()
        mock_task = loop.create_task(_noop())
        await mock_task  # let it complete

        server._server = mock_uvicorn_server
        server._task = mock_task
        server._embedded_db = mock_db

        await server.stop()

        assert mock_uvicorn_server.should_exit is True
        mock_db.stop.assert_awaited_once()
        assert server._task is None
        assert server._embedded_db is None

    @pytest.mark.asyncio
    async def test_stop_no_server(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        # Should not raise when nothing is running
        await server.stop()

    @pytest.mark.asyncio
    async def test_health_check_false_when_no_server(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        assert await server.health_check() is False

    @pytest.mark.asyncio
    async def test_health_check_true_when_started(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        mock_server = MagicMock()
        mock_server.started = True
        server._server = mock_server
        assert await server.health_check() is True

    @pytest.mark.asyncio
    async def test_health_check_false_when_not_started(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        mock_server = MagicMock()
        mock_server.started = False
        server._server = mock_server
        assert await server.health_check() is False


class TestRootServerRunMigrations:
    """Tests for RootServer._run_migrations()."""

    @pytest.mark.asyncio
    async def test_skips_when_no_embedded_db(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        server._embedded_db = None
        # Should not raise
        await server._run_migrations()

    @pytest.mark.asyncio
    async def test_applies_migrations(self, tmp_path: Path) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)

        mock_db = MagicMock()
        mock_db._connection_info = ConnectionInfo(
            host="127.0.0.1", port=5432, dbname="niuu", user="postgres"
        )
        server._embedded_db = mock_db

        # Create mock migration files
        vol_dir = tmp_path / "volundr"
        vol_dir.mkdir()
        (vol_dir / "000001_init.up.sql").write_text("CREATE TABLE IF NOT EXISTS t1 (id INT);")

        tyr_dir = tmp_path / "tyr"
        tyr_dir.mkdir()
        (tyr_dir / "000001_init.up.sql").write_text("CREATE TABLE IF NOT EXISTS t2 (id INT);")

        def mock_migration_dir(variant):
            if variant == "volundr":
                return vol_dir
            if variant == "tyr":
                return tyr_dir
            raise FileNotFoundError

        mock_conn = AsyncMock()

        with (
            patch("asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn),
            patch("cli.resources.migration_dir", side_effect=mock_migration_dir),
        ):
            await server._run_migrations()

        assert mock_conn.execute.await_count == 2
        mock_conn.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handles_migration_errors_gracefully(self, tmp_path: Path) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)

        mock_db = MagicMock()
        mock_db._connection_info = ConnectionInfo(
            host="127.0.0.1", port=5432, dbname="niuu", user="postgres"
        )
        server._embedded_db = mock_db

        vol_dir = tmp_path / "volundr"
        vol_dir.mkdir()
        (vol_dir / "000001_init.up.sql").write_text("INVALID SQL;")

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(side_effect=Exception("syntax error"))

        with (
            patch("asyncpg.connect", new_callable=AsyncMock, return_value=mock_conn),
            patch("cli.resources.migration_dir", side_effect=[vol_dir, FileNotFoundError]),
        ):
            # Should not raise
            await server._run_migrations()

    @pytest.mark.asyncio
    async def test_handles_connect_failure_gracefully(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)

        mock_db = MagicMock()
        mock_db._connection_info = ConnectionInfo(
            host="127.0.0.1", port=5432, dbname="niuu", user="postgres"
        )
        server._embedded_db = mock_db

        with patch("asyncpg.connect", new_callable=AsyncMock, side_effect=Exception("fail")):
            # Should not raise
            await server._run_migrations()


class TestRootServerStartEmbeddedDb:
    """Tests for RootServer._start_embedded_db()."""

    @pytest.mark.asyncio
    async def test_starts_and_sets_env_vars(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)

        mock_db = AsyncMock()
        mock_db.start = AsyncMock(return_value=ConnectionInfo(
            host="localhost", port=5433, dbname="testdb", user="testuser"
        ))

        with patch(
            "niuu.adapters.pgserver_embedded.PgserverEmbeddedDatabase",
            return_value=mock_db,
        ):
            await server._start_embedded_db()

        assert server._embedded_db is mock_db
        assert os.environ["DATABASE__HOST"] == "localhost"
        assert os.environ["DATABASE__PORT"] == "5433"
        assert os.environ["DATABASE__USER"] == "testuser"
        assert os.environ["DATABASE__NAME"] == "testdb"


class TestRootServerLifespan:
    """Tests for the root app lifespan (sub-app startup/shutdown)."""

    def test_lifespan_starts_and_stops_sub_apps(self) -> None:
        """Sub-app lifespans are started on enter and stopped on exit."""
        from contextlib import asynccontextmanager

        started = []
        stopped = []

        @asynccontextmanager
        async def sub_lifespan(app):
            started.append("volundr")
            yield
            stopped.append("volundr")

        sub_app = FastAPI(lifespan=sub_lifespan)

        @sub_app.get("/api/v1/volundr/ping")
        async def ping():
            return {"pong": True}

        class VolundrPlugin(FakePlugin):
            def create_api_app(self):
                return sub_app

        registry = PluginRegistry()
        registry.register(VolundrPlugin(name="volundr"))

        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()

        # TestClient with context manager triggers lifespan
        with TestClient(app) as client:
            assert "volundr" in started
            resp = client.get("/health")
            assert resp.status_code == 200

        assert "volundr" in stopped

    def test_lifespan_handles_sub_app_start_failure(self) -> None:
        """If a sub-app lifespan fails to start, others still work."""
        from contextlib import asynccontextmanager

        @asynccontextmanager
        async def broken_lifespan(app):
            raise RuntimeError("Startup failed")
            yield  # noqa: RET503 — unreachable but required by async gen

        sub_app = FastAPI(lifespan=broken_lifespan)

        @sub_app.get("/api/v1/volundr/ping")
        async def ping():
            return {"pong": True}

        class VolundrPlugin(FakePlugin):
            def create_api_app(self):
                return sub_app

        registry = PluginRegistry()
        registry.register(VolundrPlugin(name="volundr"))

        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()

        # Should not raise despite sub-app failure
        with TestClient(app) as client:
            resp = client.get("/health")
            assert resp.status_code == 200


class TestSkuldWsProxy:
    """Tests for the Skuld WebSocket proxy endpoint."""

    def test_ws_proxy_session_not_found(self) -> None:
        registry = PluginRegistry()
        server = RootServer(registry=registry)
        with patch.dict(os.environ, {"NIUU_NO_WEB": "true"}):
            app = server._build_app()
        client = TestClient(app)
        with pytest.raises(Exception):
            # WebSocket to unknown session should close with 4004
            with client.websocket_connect("/s/unknown/session"):
                pass


class TestPluginApiPrefixes:
    """Tests for the _PLUGIN_API_PREFIXES constant."""

    def test_has_expected_plugins(self) -> None:
        assert "volundr" in _PLUGIN_API_PREFIXES
        assert "tyr" in _PLUGIN_API_PREFIXES
        assert "niuu" in _PLUGIN_API_PREFIXES

    def test_prefixes_start_with_api(self) -> None:
        for name, prefixes in _PLUGIN_API_PREFIXES.items():
            for prefix in prefixes:
                assert prefix.startswith("/api/v1/"), f"{name}: {prefix}"
