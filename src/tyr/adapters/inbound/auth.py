"""FastAPI authentication dependency for Tyr.

Reads identity from Envoy-injected trusted headers. In dev/test (no Envoy),
falls back to allow-all with a default identity.
"""

from __future__ import annotations

from fastapi import Request

from niuu.domain.models import Principal


async def extract_principal(request: Request) -> Principal:
    """Read identity from Envoy-injected trusted headers.

    In dev/test (no Envoy), falls back to allow-all with a default identity.
    """
    user_id = request.headers.get("x-auth-user-id", "")
    if not user_id:
        return Principal(
            user_id="default",
            email="",
            tenant_id="",
            roles=["volundr:developer"],
        )
    return Principal(
        user_id=user_id,
        email=request.headers.get("x-auth-email", ""),
        tenant_id=request.headers.get("x-auth-tenant", ""),
        roles=request.headers.get("x-auth-roles", "volundr:developer").split(","),
    )
