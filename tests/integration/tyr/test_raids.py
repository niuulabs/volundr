"""Integration tests for Tyr raid endpoints.

Exercises the raids summary endpoint that queries PostgreSQL directly,
verifying that committed raids are counted correctly by status.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_raid_summary_empty(tyr_client: AsyncClient) -> None:
    """GET /api/v1/tyr/raids/summary returns zero counts when no raids exist."""
    resp = await tyr_client.get("/api/v1/tyr/raids/summary")
    assert resp.status_code == 200

    body = resp.json()
    assert body["PENDING"] == 0
    assert body["RUNNING"] == 0
    assert body["MERGED"] == 0


@pytest.mark.integration
@pytest.mark.asyncio(loop_scope="session")
async def test_raid_summary_after_commit(tyr_client: AsyncClient) -> None:
    """Commit a saga with raids, then GET /summary and verify PENDING count."""
    payload = {
        "name": "Raid Count Test",
        "slug": "raid-count-test",
        "repos": ["niuulabs/volundr"],
        "base_branch": "main",
        "phases": [
            {
                "name": "Phase 1",
                "raids": [
                    {"name": "Raid A"},
                    {"name": "Raid B"},
                    {"name": "Raid C"},
                ],
            },
        ],
    }
    resp = await tyr_client.post("/api/v1/tyr/sagas/commit", json=payload)
    assert resp.status_code == 201

    summary_resp = await tyr_client.get("/api/v1/tyr/raids/summary")
    assert summary_resp.status_code == 200

    body = summary_resp.json()
    assert body["PENDING"] == 3
