"""Agent authentication for Bifröst.

Supports three modes:

- ``open``  — No authentication required. Headers are trusted as-is
              (suitable for local/Pi mode or behind a trusted proxy).
- ``pat``   — Bearer token must be a valid Bifröst Personal Access Token
              (HS256 JWT signed with ``pat_secret``).
- ``mesh``  — Trust Envoy / service-mesh injected headers
              (``X-Agent-Id``, ``X-Tenant-Id``, etc.).  Envoy has already
              verified the caller's identity; no further validation needed.

In all modes the standard attribution headers (``X-Session-Id``,
``X-Saga-Id``) are extracted from the request and forwarded to tracking.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

import jwt
from fastapi import HTTPException, Request


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
    allowed_models: list[str] = field(default_factory=list)
    """Models this agent is permitted to use (empty = all models allowed)."""


_ANON = AgentIdentity()


def _read_attribution_headers(request: Request) -> tuple[str, str]:
    """Return (session_id, saga_id) from standard attribution headers."""
    return (
        request.headers.get("x-session-id", ""),
        request.headers.get("x-saga-id", ""),
    )


def _extract_open(request: Request) -> AgentIdentity:
    """Open mode: trust any headers the caller provides."""
    session_id, saga_id = _read_attribution_headers(request)
    return AgentIdentity(
        agent_id=request.headers.get("x-agent-id", "anonymous"),
        tenant_id=request.headers.get("x-tenant-id", "default"),
        session_id=session_id,
        saga_id=saga_id,
    )


def _extract_mesh(request: Request) -> AgentIdentity:
    """Mesh mode: read Envoy-injected identity headers."""
    session_id, saga_id = _read_attribution_headers(request)
    return AgentIdentity(
        agent_id=request.headers.get("x-agent-id", "anonymous"),
        tenant_id=request.headers.get("x-tenant-id", "default"),
        session_id=session_id,
        saga_id=saga_id,
    )


def _extract_pat(request: Request, secret: str) -> AgentIdentity:
    """PAT mode: validate Bearer JWT and extract claims."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    token = auth_header[7:]
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc

    session_id, saga_id = _read_attribution_headers(request)
    return AgentIdentity(
        agent_id=payload.get("sub", "anonymous"),
        tenant_id=payload.get("tenant_id", "default"),
        session_id=session_id,
        saga_id=saga_id,
    )


def extract_identity(
    request: Request,
    mode: AuthMode,
    secret: str = "",
) -> AgentIdentity:
    """Extract caller identity from *request* according to *mode*.

    Args:
        request: The incoming FastAPI request.
        mode:    Authentication mode (open / pat / mesh).
        secret:  HS256 signing secret used in ``pat`` mode.

    Returns:
        ``AgentIdentity`` populated from request headers / JWT claims.

    Raises:
        HTTPException(401): In ``pat`` mode when the token is absent or invalid.
    """
    match mode:
        case AuthMode.PAT:
            return _extract_pat(request, secret)
        case AuthMode.MESH:
            return _extract_mesh(request)
        case _:
            return _extract_open(request)
