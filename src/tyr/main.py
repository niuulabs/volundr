"""Application factory for Tyr saga coordinator."""

import os

from fastapi import FastAPI

from tyr.config import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Create and configure the FastAPI application."""
    if settings is None:
        settings = Settings()

    app = FastAPI(
        title="Tyr",
        description="Saga coordinator service",
        version="0.1.0",
    )

    app.state.settings = settings

    @app.get("/health", tags=["Health"])
    async def health_check() -> dict[str, str]:
        """Health check endpoint."""
        return {"status": "healthy"}

    return app


app = create_app()


def main() -> None:  # pragma: no cover
    """Run the Tyr API server."""
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8081"))
    workers = int(os.environ.get("WORKERS", "4"))

    uvicorn.run(
        "tyr.main:app",
        host=host,
        port=port,
        workers=workers,
        access_log=False,
    )


if __name__ == "__main__":  # pragma: no cover
    main()
