"""Agent authentication for Bifröst.

Defines the core identity types shared across all authentication modes:

- ``AuthMode``         — enum of supported authentication modes.
- ``AgentIdentity``    — caller identity attached to every tracked request.
- ``_read_attribution_headers`` — helper used by auth adapters.

Authentication logic lives in the adapter layer:
  ``bifrost.adapters.auth.open``  — Open / trust-all mode
  ``bifrost.adapters.auth.pat``   — PAT Bearer-JWT mode
  ``bifrost.adapters.auth.mesh``  — Service-mesh / Envoy mTLS mode
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from fastapi import Request


class AuthMode(StrEnum):
    """Authentication mode for the Bifröst gateway."""

    OPEN = "open"
    """No authentication — headers are trusted verbatim."""

    PAT = "pat"
    """Bearer-token Personal Access Token (HS256 JWT)."""

    MESH = "mesh"
    """Service-mesh / Envoy injected identity headers."""


@dataclass
class AgentIdentity:
    """Caller identity attached to every tracked request."""

    agent_id: str = "anonymous"
    tenant_id: str = "default"
    session_id: str = ""
    saga_id: str = ""


def _read_attribution_headers(request: Request) -> tuple[str, str]:
    """Return (session_id, saga_id) from standard attribution headers."""
    return (
        request.headers.get("x-session-id", ""),
        request.headers.get("x-saga-id", ""),
    )
