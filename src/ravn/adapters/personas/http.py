"""HttpPersonaAdapter — fetches personas from the volundr REST registry.

Used when ravn sidecars cannot mount ConfigMaps and need to pull persona
definitions from a central volundr instance at runtime.

Auth
----
The adapter reads a PAT from an environment variable (default
``RAVN_VOLUNDR_TOKEN``) and sends it as ``Authorization: Bearer <token>``.
The token is mounted as a Kubernetes secret in production.

Cache
-----
Responses are cached in-memory with a configurable TTL (default 60 s).  This
prevents hammering volundr on every ravn decision cycle, while still allowing
edits to propagate within one TTL window.

Fail-closed
-----------
Network errors and 5xx responses are treated as transient failures:

* ``load()`` returns the last cached value, or ``None`` if nothing is cached.
* ``list_names()`` returns the last cached list, or ``[]`` if nothing is cached.

Neither method raises on transport or server errors so the ravn sidecar can
keep running with stale data rather than crashing.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Any

import httpx

from ravn.adapters.personas.loader import (
    PersonaConfig,
    PersonaConsumes,
    PersonaFanIn,
    PersonaLLMConfig,
    PersonaProduces,
)
from ravn.ports.persona import PersonaPort

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT_SECONDS: float = 5.0
_DEFAULT_CACHE_TTL_SECONDS: int = 60
_DEFAULT_TOKEN_ENV: str = "RAVN_VOLUNDR_TOKEN"


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float


class HttpPersonaAdapter(PersonaPort):
    """Read-only PersonaPort that fetches personas from the volundr REST registry.

    Args:
        base_url:           Base URL of the volundr service, e.g. ``http://volundr:8080``.
        timeout_seconds:    HTTP request timeout (default 5 s).
        cache_ttl_seconds:  Cache lifetime per persona (default 60 s).
        token_env:          Name of the env var that holds the PAT
                            (default ``RAVN_VOLUNDR_TOKEN``).
    """

    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: float = _DEFAULT_TIMEOUT_SECONDS,
        cache_ttl_seconds: int = _DEFAULT_CACHE_TTL_SECONDS,
        token_env: str = _DEFAULT_TOKEN_ENV,
        # Private: injected in tests to avoid real network calls.
        _transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout_seconds
        self._ttl = cache_ttl_seconds
        self._token_env = token_env
        self._transport = _transport

        # Per-persona cache: name → _CacheEntry(PersonaConfig | None, expires_at)
        self._persona_cache: dict[str, _CacheEntry] = {}
        # Names-list cache: _CacheEntry(list[str], expires_at) | None
        self._names_cache: _CacheEntry | None = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _auth_headers(self) -> dict[str, str]:
        token = os.environ.get(self._token_env, "")
        if not token:
            return {}
        return {"Authorization": f"Bearer {token}"}

    def _is_fresh(self, entry: _CacheEntry) -> bool:
        return time.monotonic() < entry.expires_at

    def _new_entry(self, value: Any) -> _CacheEntry:
        return _CacheEntry(value=value, expires_at=time.monotonic() + self._ttl)

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=self._timeout, transport=self._transport)

    @staticmethod
    def _parse_detail(data: dict) -> PersonaConfig:
        """Parse a PersonaDetail JSON payload into a PersonaConfig."""
        llm = data.get("llm") or {}
        produces = data.get("produces") or {}
        consumes = data.get("consumes") or {}
        fan_in = data.get("fan_in") or {}

        return PersonaConfig(
            name=data["name"],
            system_prompt_template=data.get("system_prompt_template", ""),
            allowed_tools=list(data.get("allowed_tools") or []),
            forbidden_tools=list(data.get("forbidden_tools") or []),
            permission_mode=data.get("permission_mode", ""),
            iteration_budget=int(data.get("iteration_budget") or 0),
            llm=PersonaLLMConfig(
                primary_alias=llm.get("primary_alias", ""),
                thinking_enabled=bool(llm.get("thinking_enabled", False)),
                max_tokens=int(llm.get("max_tokens") or 0),
            ),
            produces=PersonaProduces(
                event_type=produces.get("event_type", ""),
            ),
            consumes=PersonaConsumes(
                event_types=list(consumes.get("event_types") or []),
                injects=list(consumes.get("injects") or []),
            ),
            fan_in=PersonaFanIn(
                strategy=fan_in.get("strategy", "merge"),
                contributes_to=fan_in.get("contributes_to", ""),
            ),
        )

    # ------------------------------------------------------------------
    # PersonaPort interface
    # ------------------------------------------------------------------

    def load(self, name: str) -> PersonaConfig | None:
        """Return the named persona from volundr, or ``None`` if not found or on error.

        Results are cached for ``cache_ttl_seconds``.  On HTTP or transport
        errors the last cached value is returned (fail-closed: ``None`` if no
        prior entry exists).
        """
        cached = self._persona_cache.get(name)
        if cached is not None and self._is_fresh(cached):
            return cached.value

        url = f"{self._base_url}/api/v1/ravn/personas/{name}"
        try:
            with self._client() as client:
                response = client.get(url, headers=self._auth_headers())
        except Exception as exc:  # network / timeout
            logger.warning("HttpPersonaAdapter: request failed for %r: %s", name, exc)
            return cached.value if cached is not None else None

        if response.status_code == 404:
            # Definitively missing — do not cache so that newly created
            # personas appear within the next call rather than at TTL expiry.
            return None

        if response.status_code >= 400:
            logger.warning(
                "HttpPersonaAdapter: GET %s returned HTTP %d",
                url,
                response.status_code,
            )
            return cached.value if cached is not None else None

        config = self._parse_detail(response.json())
        self._persona_cache[name] = self._new_entry(config)
        return config

    def list_names(self) -> list[str]:
        """Return a sorted list of all persona names from the registry.

        Falls back to the last cached list on HTTP or transport errors; returns
        ``[]`` if no cached list is available.
        """
        if self._names_cache is not None and self._is_fresh(self._names_cache):
            return list(self._names_cache.value)

        url = f"{self._base_url}/api/v1/ravn/personas"
        try:
            with self._client() as client:
                response = client.get(url, headers=self._auth_headers())
        except Exception as exc:  # network / timeout
            logger.warning("HttpPersonaAdapter: list_names request failed: %s", exc)
            return list(self._names_cache.value) if self._names_cache is not None else []

        if response.status_code >= 400:
            logger.warning(
                "HttpPersonaAdapter: GET %s returned HTTP %d",
                url,
                response.status_code,
            )
            return list(self._names_cache.value) if self._names_cache is not None else []

        names = sorted(item["name"] for item in response.json())
        self._names_cache = self._new_entry(names)
        return list(names)

    # ------------------------------------------------------------------
    # Write operations — not supported
    # ------------------------------------------------------------------

    def save(self, config: PersonaConfig) -> None:  # type: ignore[override]
        raise NotImplementedError(
            "Use the volundr REST API to edit personas; this adapter is read-only."
        )

    def delete(self, name: str) -> bool:  # type: ignore[override]
        raise NotImplementedError(
            "Use the volundr REST API to edit personas; this adapter is read-only."
        )
