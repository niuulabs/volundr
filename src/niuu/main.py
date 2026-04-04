"""Application factory for the Niuu shared API."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from niuu.adapters.inbound.rest_repos import create_repos_router
from niuu.adapters.outbound.git_registry import create_git_registry
from niuu.config import GitConfig
from niuu.domain.services.repo import RepoService

logger = logging.getLogger(__name__)


def _load_git_config() -> GitConfig:
    """Load git configuration from the shared YAML config.

    Uses NiuuSettings to read the ``git:`` section from the same YAML
    config files that Volundr uses, without importing volundr.
    """
    try:
        from niuu.config import NiuuSettings

        settings = NiuuSettings()
        return settings.git
    except Exception:
        logger.debug("Could not load niuu settings for git config, using defaults")
        return GitConfig()


def create_app(git_config: GitConfig | None = None) -> FastAPI:
    """Create the Niuu shared FastAPI application.

    Args:
        git_config: Git provider configuration.  When ``None``, loaded
            from the shared YAML / env vars automatically.
    """
    app = FastAPI(
        title="Niuu Shared Services",
        description="Shared API endpoints — repos, PATs, integrations.",
        version="0.1.0",
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        cfg = git_config or _load_git_config()
        git_registry = create_git_registry(cfg)

        repo_service = RepoService(git_registry)
        app.state.git_registry = git_registry
        app.state.repo_service = repo_service

        repos_router = create_repos_router(repo_service)
        app.include_router(repos_router)

        try:
            yield
        finally:
            await git_registry.close()

    app.router.lifespan_context = lifespan

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health", tags=["Health"])
    async def health_check() -> dict[str, str]:
        return {"status": "healthy"}

    return app


app = create_app()
