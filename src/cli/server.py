"""Root ASGI server — composes plugin API apps, shared services, and web UI.

Each plugin can provide a FastAPI/ASGI sub-application via ``create_api_app()``.
Sub-apps are mounted at their API prefix (e.g. ``/api/v1/volundr``) using a
prefix-preserving mount so the sub-app sees the full original path.  This
lets each sub-app keep its own lifespan, dependency overrides, and app.state.

The embedded PostgreSQL (pgserver) is started before the sub-apps so their
lifespan handlers can connect to the database.

The web UI is mounted last as a catch-all SPA fallback.
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING

import uvicorn
from fastapi import FastAPI
from starlette.types import ASGIApp, Receive, Scope, Send

from niuu.ports.plugin import Service

if TYPE_CHECKING:
    from cli.registry import PluginRegistry
    from niuu.ports.embedded_database import EmbeddedDatabasePort

logger = logging.getLogger(__name__)

# Maps plugin name → API path prefixes that Starlette Mount uses to route.
# The prefix is stripped by Mount, then restored by _PrefixRestoreApp
# so the sub-app's own routers (which include the prefix) still match.
_PLUGIN_API_PREFIXES: dict[str, list[str]] = {
    "volundr": ["/api/v1/volundr"],
    "tyr": ["/api/v1/tyr"],
    "niuu": ["/api/v1/niuu"],
}


class _PrefixRestoreApp:
    """ASGI wrapper that restores the stripped mount prefix on the path.

    Starlette's ``Mount("/api/v1/volundr", app)`` strips the prefix before
    forwarding to the sub-app.  But FastAPI sub-apps have routers like
    ``APIRouter(prefix="/api/v1/volundr")``, so they need the full path.

    This wrapper puts the prefix back so the sub-app's routes match.
    """

    def __init__(self, app: ASGIApp, prefix: str) -> None:
        self._app = app
        self._prefix = prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            # Restore the prefix that Mount stripped
            scope = dict(scope)
            scope["path"] = self._prefix + scope["path"]
            raw = scope.get("raw_path")
            if raw:
                scope["raw_path"] = self._prefix.encode() + raw
        # Forward all events (including lifespan) to the sub-app
        await self._app(scope, receive, send)


class RootServer(Service):
    """Single in-process uvicorn server that hosts all plugin apps."""

    def __init__(
        self,
        registry: PluginRegistry,
        host: str = "127.0.0.1",
        port: int = 8080,
    ) -> None:
        self._registry = registry
        self._host = host
        self._port = port
        self._server: uvicorn.Server | None = None
        self._task: asyncio.Task[None] | None = None
        self._embedded_db: EmbeddedDatabasePort | None = None

    async def _start_embedded_db(self) -> None:
        """Start embedded PostgreSQL and set env vars for sub-apps."""
        from niuu.adapters.pgserver_embedded import PgserverEmbeddedDatabase

        data_dir = str(Path.home() / ".niuu" / "pgdata")
        db = PgserverEmbeddedDatabase()
        info = await db.start(data_dir)
        self._embedded_db = db

        # Set env vars so Volundr/Tyr DatabaseConfig picks them up.
        # Both use pydantic-settings with env_nested_delimiter="__"
        # and no env_prefix, so DATABASE__HOST etc.
        os.environ["DATABASE__HOST"] = info.host
        os.environ["DATABASE__PORT"] = str(info.port)
        os.environ["DATABASE__USER"] = info.user
        os.environ["DATABASE__PASSWORD"] = ""
        os.environ["DATABASE__NAME"] = info.dbname

        logger.info(
            "Embedded PostgreSQL ready at %s:%s/%s",
            info.host, info.port, info.dbname,
        )

    def _build_app(self) -> FastAPI:
        """Compose the root FastAPI app from all plugin sub-apps."""
        from collections.abc import AsyncGenerator
        from contextlib import asynccontextmanager

        sub_apps: list[tuple[str, FastAPI]] = []

        # Collect sub-apps before creating root (need them for lifespan)
        for name, plugin in sorted(self._registry.plugins.items()):
            if name not in _PLUGIN_API_PREFIXES:
                continue
            try:
                sub_app = plugin.create_api_app()
                if sub_app is None:
                    continue
                sub_apps.append((name, sub_app))
            except Exception:
                logger.exception("Failed to create API app for plugin: %s", name)

        @asynccontextmanager
        async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
            # Run each sub-app's lifespan so they set up DB pools, etc.
            from starlette.routing import Router

            exit_stacks: list[tuple[str, AsyncGenerator]] = []
            for name, sub_app in sub_apps:
                lf = sub_app.router.lifespan_context
                if lf:
                    gen = lf(sub_app)
                    try:
                        await gen.__aenter__()
                        exit_stacks.append((name, gen))
                        logger.info("Started %s lifespan", name)
                    except Exception:
                        logger.exception("Failed to start %s lifespan", name)

            yield

            # Shutdown in reverse order
            for name, gen in reversed(exit_stacks):
                try:
                    await gen.__aexit__(None, None, None)
                    logger.info("Stopped %s lifespan", name)
                except Exception:
                    logger.exception("Failed to stop %s lifespan", name)

        root = FastAPI(
            title="Niuu Platform",
            description="Unified API gateway for all Niuu services.",
            version="0.1.0",
            lifespan=lifespan,
        )

        @root.get("/health")
        async def health() -> dict[str, str]:
            return {"status": "ok"}

        # Mount each plugin's API app at its prefixes.
        for name, sub_app in sub_apps:
            prefixes = _PLUGIN_API_PREFIXES.get(name, [])
            if not prefixes:
                logger.debug("No API prefix configured for plugin: %s", name)
                continue
            for prefix in prefixes:
                wrapped = _PrefixRestoreApp(sub_app, prefix)
                root.mount(prefix, wrapped, name=f"{name}-{prefix.rsplit('/', 1)[-1]}")
            logger.info("Mounted %s API at %s", name, ", ".join(prefixes))

        # Runtime config for the web UI SPA
        @root.get("/config.json")
        async def config_json() -> dict:
            return {
                "apiBaseUrl": f"http://{self._host}:{self._port}",
            }

        # Web UI — SPA with fallback to index.html for deep routes
        try:
            from cli.resources import web_dist_dir
            from starlette.staticfiles import StaticFiles

            dist = web_dist_dir()
            root.mount("/assets", StaticFiles(directory=str(dist / "assets")), name="web-assets")
            if (dist / "fonts").is_dir():
                root.mount("/fonts", StaticFiles(directory=str(dist / "fonts")), name="web-fonts")

            # Serve favicon
            from starlette.responses import FileResponse

            favicon_path = dist / "favicon.svg"
            if favicon_path.exists():
                @root.get("/favicon.svg", include_in_schema=False)
                @root.get("/favicon.ico", include_in_schema=False)
                async def favicon() -> FileResponse:
                    return FileResponse(str(favicon_path), media_type="image/svg+xml")

            # SPA catch-all: any non-API path serves index.html
            index_html = (dist / "index.html").read_bytes()

            from starlette.responses import HTMLResponse

            @root.get("/{path:path}", include_in_schema=False)
            async def spa_fallback(path: str) -> HTMLResponse:
                return HTMLResponse(content=index_html)

            logger.info("Serving web UI from %s", dist)
        except FileNotFoundError:
            logger.warning("Web UI assets not found — skipping static file serving")

        return root

    async def start(self) -> None:
        # Start embedded DB first so sub-app lifespans can connect
        await self._start_embedded_db()

        # Run migrations
        await self._run_migrations()

        app = self._build_app()
        config = uvicorn.Config(
            app,
            host=self._host,
            port=self._port,
            log_level="warning",
            access_log=False,
        )
        self._server = uvicorn.Server(config)
        self._task = asyncio.create_task(self._server.serve())

    async def _run_migrations(self) -> None:
        """Run database migrations for all services."""
        if self._embedded_db is None:
            return
        try:
            import asyncpg

            from cli.resources import migration_dir

            info = self._embedded_db._connection_info
            conn = await asyncpg.connect(
                host=info.host, port=info.port,
                user=info.user, database=info.dbname,
            )
            try:
                for variant in ("volundr", "tyr"):
                    try:
                        mig_dir = migration_dir(variant)
                    except FileNotFoundError:
                        logger.debug("No migrations found for %s", variant)
                        continue
                    sql_files = sorted(mig_dir.glob("*.up.sql"))
                    applied = 0
                    for sql_file in sql_files:
                        sql = sql_file.read_text()
                        try:
                            await conn.execute(sql)
                            applied += 1
                        except Exception:
                            # Idempotent migrations may fail on already-applied
                            # schema changes (e.g. renaming columns that were
                            # never created with the old name). Safe to skip.
                            logger.debug("Migration %s skipped: %s", sql_file.name, exc_info=True)
                    logger.info("Applied %d/%d %s migrations", applied, len(sql_files), variant)
            finally:
                await conn.close()
        except Exception:
            logger.exception("Failed to run migrations")

    async def stop(self) -> None:
        if self._server:
            self._server.should_exit = True
        if self._task:
            await self._task
            self._task = None
        if self._embedded_db:
            await self._embedded_db.stop()
            self._embedded_db = None

    async def health_check(self) -> bool:
        return self._server is not None and self._server.started
