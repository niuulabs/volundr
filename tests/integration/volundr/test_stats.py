"""Integration tests for stats and models endpoints."""

from __future__ import annotations

import httpx
import pytest

BASE = "/api/v1/volundr"


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_stats_empty_db(volundr_client: httpx.AsyncClient, auth_headers):
    """GET /api/stats on an empty database returns zero counters."""
    headers = auth_headers()
    resp = await volundr_client.get(f"{BASE}/stats", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["active_sessions"] == 0
    assert body["tokens_today"] == 0
    assert body["cost_today"] == 0.0


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_models_list(volundr_client: httpx.AsyncClient, auth_headers):
    """GET /api/models returns the configured model list."""
    headers = auth_headers()
    resp = await volundr_client.get(f"{BASE}/models", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    # The default HardcodedPricingProvider always returns at least one model
    assert isinstance(body, list)
    assert len(body) > 0
    first = body[0]
    assert "id" in first
    assert "name" in first
