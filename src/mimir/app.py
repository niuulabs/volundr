"""Standalone Mímir FastAPI application.

Used when running Mímir as an independent service (``python -m mimir serve``).
The same ``MimirRouter`` can also be mounted on the existing Ravn gateway
(``ravn listen-mimir``) without any code changes.

Usage (standalone)::

    from mimir.app import create_app
    from mimir.config import MimirServiceConfig
    import uvicorn

    config = MimirServiceConfig(path="~/.ravn/mimir", name="shared", role="shared")
    app = create_app(config)
    uvicorn.run(app, host=config.host, port=config.port)
"""

from __future__ import annotations

import logging

from fastapi import FastAPI

from mimir.adapters.markdown import MarkdownMimirAdapter
from mimir.config import MimirServiceConfig
from mimir.router import MimirRouter

logger = logging.getLogger(__name__)


def create_app(config: MimirServiceConfig) -> FastAPI:
    """Create the standalone Mímir FastAPI application.

    Args:
        config: Service configuration (path, host, port, name, role).

    Returns:
        A configured FastAPI application with the Mímir router mounted at
        ``/mimir``.
    """
    adapter = MarkdownMimirAdapter(root=config.path)
    mimir_router = MimirRouter(adapter=adapter, name=config.name, role=config.role)

    app = FastAPI(
        title=f"Mímir — {config.name}",
        description=(
            "Standalone Mímir knowledge service. "
            f"Role: {config.role}. "
            "Exposes the Mímir wiki over HTTP for Ravens, Valkyries, and Pi room nodes."
        ),
        version="1.0.0",
        docs_url="/mimir/docs",
        redoc_url=None,
    )

    app.include_router(mimir_router.router, prefix="/mimir")

    @app.on_event("startup")
    async def _announce() -> None:
        if config.announce_url:
            logger.info(
                "mimir[%s]: announcing at %s (role=%s)",
                config.name,
                config.announce_url,
                config.role,
            )
            # Sleipnir announce — best-effort, no hard dependency
            try:
                from ravn.adapters.mesh.sleipnir_mesh import _announce_mimir  # type: ignore[import]

                await _announce_mimir(
                    name=config.name,
                    url=config.announce_url,
                    role=config.role,
                    categories=config.categories,
                )
            except Exception as exc:  # noqa: BLE001
                logger.debug("mimir: sleipnir announce skipped (%s)", exc)

    return app
