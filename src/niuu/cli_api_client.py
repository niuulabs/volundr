"""Lightweight HTTP client for CLI commands.

Wraps httpx to provide a simple sync interface for the CLI layer.
Each plugin creates one via create_api_client() and passes it to commands.
"""

from __future__ import annotations

from typing import Any

import httpx

DEFAULT_TIMEOUT = 30.0


class CLIAPIClient:
    """Sync HTTP client for CLI → API communication."""

    def __init__(
        self,
        base_url: str,
        auth_token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._auth_token = auth_token
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        if self._auth_token:
            return {"Authorization": f"Bearer {self._auth_token}"}
        return {}

    def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> httpx.Response:
        """Execute an HTTP request and return the raw response."""
        with httpx.Client(timeout=self._timeout) as client:
            return client.request(
                method,
                f"{self._base_url}{path}",
                headers=self._headers(),
                json=json_body,
            )

    def get(self, path: str) -> httpx.Response:
        return self._request("GET", path)

    def post(self, path: str, *, json_body: dict[str, Any] | None = None) -> httpx.Response:
        return self._request("POST", path, json_body=json_body)

    def delete(self, path: str) -> httpx.Response:
        return self._request("DELETE", path)
