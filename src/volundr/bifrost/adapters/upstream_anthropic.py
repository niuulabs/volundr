"""Anthropic direct upstream adapter — zero-overhead pass-through."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

import httpx

from volundr.bifrost.config import UpstreamConfig
from volundr.bifrost.ports import UpstreamProvider

logger = logging.getLogger(__name__)

# Headers we forward from the client to the upstream.
_FORWARD_HEADERS = frozenset(
    {
        "content-type",
        "anthropic-version",
        "anthropic-beta",
        "accept",
    }
)

# Auth-related headers — forwarded only in passthrough mode.
_AUTH_HEADERS = frozenset({"x-api-key", "authorization"})

# Headers we never forward (managed by httpx / transport layer).
_STRIP_HEADERS = frozenset(
    {
        "host",
        "connection",
        "transfer-encoding",
        "content-length",
        "accept-encoding",
    }
)

# Response headers we strip before returning to the client.
_STRIP_RESPONSE_HEADERS = frozenset(
    {
        "transfer-encoding",
        "content-length",
        "connection",
        "keep-alive",
    }
)


class AnthropicDirectAdapter(UpstreamProvider):
    """Pass-through adapter for Anthropic-compatible upstreams.

    No format translation — the request and response are forwarded
    byte-for-byte.  This is the hot path for ``api.anthropic.com`` and
    any upstream that speaks the Anthropic Messages API natively (e.g.
    Ollama's ``/v1/messages``).
    """

    def __init__(self, config: UpstreamConfig) -> None:
        self._config = config
        self._base_url = config.url.rstrip("/")
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                timeout=config.timeout_s,
                connect=config.connect_timeout_s,
            ),
            follow_redirects=False,
        )

    # ------------------------------------------------------------------
    # UpstreamProvider interface
    # ------------------------------------------------------------------

    async def forward(
        self,
        body: bytes,
        headers: dict[str, str],
    ) -> tuple[int, dict[str, str], bytes]:
        upstream_headers = self._build_upstream_headers(headers)
        url = f"{self._base_url}/v1/messages"

        response = await self._client.post(
            url,
            content=body,
            headers=upstream_headers,
        )

        resp_headers = self._filter_response_headers(dict(response.headers))
        return response.status_code, resp_headers, response.content

    async def stream_forward(
        self,
        body: bytes,
        headers: dict[str, str],
    ) -> tuple[int, dict[str, str], AsyncIterator[bytes]]:
        upstream_headers = self._build_upstream_headers(headers)
        url = f"{self._base_url}/v1/messages"

        # We must keep the response context open for the lifetime of the
        # iterator, so we use send() with a manually built request.
        request = self._client.build_request(
            "POST",
            url,
            content=body,
            headers=upstream_headers,
        )
        response = await self._client.send(request, stream=True)

        resp_headers = self._filter_response_headers(dict(response.headers))
        return response.status_code, resp_headers, self._iter_and_close(response)

    async def close(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _build_upstream_headers(
        self,
        client_headers: dict[str, str],
    ) -> dict[str, str]:
        result: dict[str, str] = {}

        lower_headers = {k.lower(): v for k, v in client_headers.items()}

        for name in _FORWARD_HEADERS:
            if name in lower_headers:
                result[name] = lower_headers[name]

        auth_mode = self._config.auth.mode

        if auth_mode == "passthrough":
            for name in _AUTH_HEADERS:
                if name in lower_headers:
                    result[name] = lower_headers[name]
        elif auth_mode == "api_key":
            resolved = self._config.auth.resolve_key()
            if resolved:
                result["x-api-key"] = resolved

        return result

    @staticmethod
    def _filter_response_headers(headers: dict[str, str]) -> dict[str, str]:
        return {k: v for k, v in headers.items() if k.lower() not in _STRIP_RESPONSE_HEADERS}

    @staticmethod
    async def _iter_and_close(response: httpx.Response) -> AsyncIterator[bytes]:
        """Yield raw bytes from the response, then close it."""
        try:
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()
