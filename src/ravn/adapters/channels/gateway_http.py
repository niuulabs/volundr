"""HTTP gateway — FastAPI server for local/LAN access to Ravn.

Endpoints:
  POST /chat    — send a message; response is an SSE stream of RavnEvents.
  GET  /status  — JSON: active session IDs and count.
  GET  /events  — SSE broadcast of *all* events across all sessions.

Runs via uvicorn inside an asyncio task (no subprocess).
Suitable for Home Assistant automations, local scripts, and cron jobs.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ravn.adapters.channels.gateway import RavnGateway
from ravn.config import HttpChannelConfig

logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    """Body schema for ``POST /chat``."""

    message: str
    session_id: str = "http:default"


class HttpGateway:
    """FastAPI-based HTTP gateway for Ravn.

    Each call to ``POST /chat`` streams :class:`~ravn.domain.events.RavnEvent`
    objects as Server-Sent Events so callers can display streaming output.

    ``GET /events`` broadcasts *all* events from *all* active sessions to the
    subscriber — useful for dashboards or Home Assistant integrations.
    """

    def __init__(
        self,
        config: HttpChannelConfig,
        gateway: RavnGateway,
    ) -> None:
        self._config = config
        self._gateway = gateway
        self._app = self._build_app()

    @property
    def app(self) -> FastAPI:
        """The underlying FastAPI application (useful for testing)."""
        return self._app

    # ------------------------------------------------------------------
    # FastAPI application
    # ------------------------------------------------------------------

    def _build_app(self) -> FastAPI:
        app = FastAPI(title="Ravn Gateway", docs_url=None, redoc_url=None)

        @app.post("/chat")
        async def chat(request: ChatRequest) -> StreamingResponse:
            """Send a message to Ravn and receive a streaming SSE response."""
            return StreamingResponse(
                self._chat_stream(request.session_id, request.message),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )

        @app.get("/status")
        async def status() -> dict:
            """Return active session IDs and session count."""
            ids = self._gateway.session_ids()
            return {"session_count": len(ids), "active_sessions": ids}

        @app.get("/events")
        async def events() -> StreamingResponse:
            """SSE broadcast stream — receive all events from all sessions."""
            return StreamingResponse(
                self._broadcast_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )

        return app

    # ------------------------------------------------------------------
    # Stream generators
    # ------------------------------------------------------------------

    async def _chat_stream(self, session_id: str, message: str) -> AsyncIterator[str]:
        """Yield SSE-formatted lines for each event from a chat turn."""
        async for event in self._gateway.handle_message_stream(session_id, message):
            payload = json.dumps(
                {
                    "type": str(event.type),
                    "data": event.data,
                    "metadata": event.metadata,
                }
            )
            yield f"data: {payload}\n\n"

    async def _broadcast_stream(self) -> AsyncIterator[str]:
        """Yield SSE-formatted lines for every event across all sessions."""
        q = self._gateway.subscribe()
        try:
            while True:
                event = await q.get()
                if event is None:
                    break
                payload = json.dumps(
                    {
                        "type": str(event.type),
                        "data": event.data,
                        "metadata": event.metadata,
                    }
                )
                yield f"data: {payload}\n\n"
        finally:
            self._gateway.unsubscribe(q)

    # ------------------------------------------------------------------
    # Server lifecycle
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """Start the uvicorn server and block until cancelled."""
        import uvicorn

        uv_config = uvicorn.Config(
            app=self._app,
            host=self._config.host,
            port=self._config.port,
            log_level="warning",
            access_log=False,
        )
        server = uvicorn.Server(uv_config)
        logger.info(
            "HTTP gateway listening on %s:%s.",
            self._config.host,
            self._config.port,
        )
        try:
            await server.serve()
        except asyncio.CancelledError:
            logger.info("HTTP gateway stopped.")
            raise
