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

    Re-uses Volundr's Settings loader since the git section is common.
    Falls back to an empty GitConfig if Volundr settings are unavailable.
    """
    try:
        from volundr.config import Settings

        settings = Settings()
        return GitConfig(github=settings.git.github, gitlab=settings.git.gitlab)
    except Exception:
        logger.debug("Could not load Volundr settings for git config, using defaults")
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
