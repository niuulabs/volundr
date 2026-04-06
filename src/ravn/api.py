"""Ravn FastAPI sub-application.

Mounted by RavnPlugin into the niuu platform server under /api/v1/ravn/.
Exposes session management endpoints consumed by the CLI and the web UI.
"""

from __future__ import annotations

from fastapi import FastAPI


def create_app() -> FastAPI:
    """Create and return the Ravn FastAPI sub-application."""
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

    return app
