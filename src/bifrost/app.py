"""Bifröst FastAPI application.

Exposes an Anthropic-compatible ``POST /v1/messages`` endpoint that routes
requests to the configured providers (Anthropic, OpenAI, Ollama, generic).
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from bifrost.config import BifrostConfig
from bifrost.router import ModelRouter, RouterError
from bifrost.translation.models import AnthropicRequest

logger = logging.getLogger(__name__)


def create_app(config: BifrostConfig) -> FastAPI:
    """Create and return the Bifröst FastAPI application.

    Args:
        config: Gateway configuration (providers, aliases, etc.).

    Returns:
        A configured ``FastAPI`` instance.
    """
    router = ModelRouter(config)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await router.close()

    app = FastAPI(
        title="Bifröst LLM Gateway",
        description="Multi-provider LLM gateway with Anthropic-compatible API.",
        version="0.1.0",
        lifespan=lifespan,
    )

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    @app.post("/v1/messages", response_model=None)
    async def messages(raw_request: Request) -> JSONResponse | StreamingResponse:
        """Anthropic-compatible Messages endpoint.

        Accepts an Anthropic Messages API request body, routes it to the
        configured provider, and returns the response in Anthropic format.
        """
        try:
            body = await raw_request.json()
            request = AnthropicRequest.model_validate(body)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        try:
            if request.stream:
                return StreamingResponse(
                    router.stream(request),
                    media_type="text/event-stream",
                    headers={
                        "cache-control": "no-cache",
                        "x-accel-buffering": "no",
                    },
                )
            response = await router.complete(request)
            return JSONResponse(content=response.model_dump())
        except RouterError as exc:
            logger.error("Routing failed: %s", exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    return app
