"""Ravn FastAPI sub-application.

Mounted by RavnPlugin into the niuu platform server under /api/v1/ravn/.
Exposes session management and persona management endpoints consumed by the
CLI and the web UI.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import FastAPI

if TYPE_CHECKING:
    from ravn.ports.persona import PersonaRegistryPort


def create_app(persona_loader: PersonaRegistryPort | None = None) -> FastAPI:
    """Create and return the Ravn FastAPI sub-application.

    Args:
        persona_loader: Optional persona registry. When provided, the persona
            CRUD routes are mounted at /api/v1/ravn/personas. When omitted
            (e.g. in tests that only need session endpoints) persona routes
            are not included.
    """
    app = FastAPI(title="Ravn API", docs_url=None, redoc_url=None)

    @app.get("/api/v1/ravn/status")
    async def status() -> dict:
        """Return basic Ravn platform status."""
        return {"service": "ravn", "session_count": 0, "healthy": True}

    @app.get("/api/v1/ravn/sessions")
    async def list_sessions() -> list:
        """List active agent sessions (stub — populated by gateway in production)."""
        return []

    @app.post("/api/v1/ravn/sessions/{session_id}/stop")
    async def stop_session(session_id: str) -> dict:
        """Stop an active agent session."""
        return {"session_id": session_id, "status": "stopped"}

    if persona_loader is not None:
        from ravn.api.personas import create_personas_router

        app.include_router(create_personas_router(persona_loader))

    return app
