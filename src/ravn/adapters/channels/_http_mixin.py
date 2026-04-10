"""Shared HTTP client mixin for Ravn gateway adapters.

All adapters need the same pattern: use an injected ``httpx.AsyncClient``
when provided (enables unit testing), otherwise create an ephemeral one.
This mixin centralises that boilerplate so each adapter only writes the
business logic around it.

Subclasses must declare ``_http_client: httpx.AsyncClient | None``.
"""

from __future__ import annotations

from typing import Any

import httpx


class GatewayHttpMixin:
    """Provides ``_http_get``, ``_http_post``, and ``_http_put`` helpers.

    When ``_http_client`` is set (injected in tests), it is reused across
    calls.  When it is ``None``, an ephemeral client is created per call —
    the standard production path.
    """

    _http_client: httpx.AsyncClient | None

    async def _http_get(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        params: dict[str, str | int] | None = None,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        client = self._http_client
        if client is not None:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            return resp.json()
        kw: dict[str, Any] = {}
        if timeout is not None:
            kw["timeout"] = timeout
        async with httpx.AsyncClient(**kw) as c:  # pragma: no cover
            resp = await c.get(url, headers=headers, params=params)  # pragma: no cover
            resp.raise_for_status()  # pragma: no cover
            return resp.json()  # pragma: no cover

    async def _http_post(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        client = self._http_client
        if client is not None:
            resp = await client.post(url, headers=headers, **kwargs)
            resp.raise_for_status()
            return resp.json()
        async with httpx.AsyncClient() as c:  # pragma: no cover
            resp = await c.post(url, headers=headers, **kwargs)  # pragma: no cover
            resp.raise_for_status()  # pragma: no cover
            return resp.json()  # pragma: no cover

    async def _http_put(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        client = self._http_client
        if client is not None:
            resp = await client.put(url, headers=headers, **kwargs)
            resp.raise_for_status()
            return resp.json()
        async with httpx.AsyncClient() as c:  # pragma: no cover
            resp = await c.put(url, headers=headers, **kwargs)  # pragma: no cover
            resp.raise_for_status()  # pragma: no cover
            return resp.json()  # pragma: no cover
