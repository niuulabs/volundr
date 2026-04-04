"""Integration test for Tyr health endpoint."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
async def test_health_endpoint(tyr_client: AsyncClient) -> None:
    """GET /health returns 200 with status ok."""
    resp = await tyr_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
