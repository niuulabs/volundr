"""Lightweight HTTP client for CLI commands.

Wraps httpx to provide a simple sync interface for the CLI layer.
Each plugin creates one via create_api_client() and passes it to commands.
"""

from __future__ import annotations

from typing import Any

import httpx

from niuu.cli_output import handle_api_error, handle_transport_error

DEFAULT_TIMEOUT = 30.0


class CLIAPIClient:
    """Sync HTTP client for CLI -> API communication."""

    def __init__(
        self,
        base_url: str,
        auth_token: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        service_name: str = "the service",
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._auth_token = auth_token
        self._timeout = timeout
        self._service_name = service_name

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

    def request_or_exit(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> httpx.Response:
        """Execute a request, handling errors with user-friendly output.

        On HTTP errors: prints formatted error panel and exits.
        On transport errors (connect, timeout, read): prints connection
        error panel and exits.
        """
        try:
            resp = self._request(method, path, json_body=json_body)
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            handle_api_error(exc)
        except httpx.TransportError:
            handle_transport_error(self._service_name)
        return resp

    def get(self, path: str) -> httpx.Response:
        return self._request("GET", path)

    def post(self, path: str, *, json_body: dict[str, Any] | None = None) -> httpx.Response:
        return self._request("POST", path, json_body=json_body)

    def delete(self, path: str) -> httpx.Response:
        return self._request("DELETE", path)
