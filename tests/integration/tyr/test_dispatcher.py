"""Integration tests for Tyr dispatcher endpoints.

Exercises GET and PATCH on dispatcher state, verifying SQL round-trips
against real PostgreSQL.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
async def test_get_dispatcher_state(tyr_client: AsyncClient) -> None:
    """GET /api/v1/tyr/dispatcher creates a default state and returns it."""
    resp = await tyr_client.get("/api/v1/tyr/dispatcher")
    assert resp.status_code == 200

    body = resp.json()
    assert body["running"] is True
    assert body["threshold"] == 0.75
    assert body["max_concurrent_raids"] == 3
    assert "id" in body
    assert "updated_at" in body


@pytest.mark.integration
async def test_patch_dispatcher_state(tyr_client: AsyncClient) -> None:
    """PATCH /api/v1/tyr/dispatcher updates fields and returns new state."""
    # Ensure a default row exists first
    await tyr_client.get("/api/v1/tyr/dispatcher")

    resp = await tyr_client.patch(
        "/api/v1/tyr/dispatcher",
        json={
            "running": False,
            "threshold": 0.50,
            "max_concurrent_raids": 5,
        },
    )
    assert resp.status_code == 200

    body = resp.json()
    assert body["running"] is False
    assert body["threshold"] == 0.50
    assert body["max_concurrent_raids"] == 5

    # Verify persistence via a fresh GET
    verify_resp = await tyr_client.get("/api/v1/tyr/dispatcher")
    verify_body = verify_resp.json()
    assert verify_body["running"] is False
    assert verify_body["threshold"] == 0.50
    assert verify_body["max_concurrent_raids"] == 5
