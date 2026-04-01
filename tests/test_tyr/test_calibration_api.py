"""Tests for the calibration and outcome override REST API (NIU-338)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from niuu.domain.models import Principal
from tyr.adapters.inbound.auth import extract_principal
from tyr.api.calibration import (
    create_calibration_router,
    resolve_outcome_repo,
)
from tyr.config import AuthConfig, Settings

from .test_outcome_resolver import StubOutcomeRepo, _make_outcome

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _build_app(repo: StubOutcomeRepo) -> FastAPI:
    settings = Settings(
        auth=AuthConfig(allow_anonymous_dev=True),
    )
    app = FastAPI()
    app.state.settings = settings
    app.include_router(create_calibration_router())

    async def _repo():
        return repo

    async def _principal():
        return Principal(user_id="test-user", email="test@test.com", tenant_id="t1", roles=[])

    app.dependency_overrides[resolve_outcome_repo] = _repo
    app.dependency_overrides[extract_principal] = _principal
    return app


# ---------------------------------------------------------------------------
# Calibration endpoint tests
# ---------------------------------------------------------------------------


def test_get_calibration_empty():
    """GET /reviewer/calibration returns zeros when no data exists."""
    repo = StubOutcomeRepo()
    client = TestClient(_build_app(repo))
    resp = client.get("/api/v1/tyr/reviewer/calibration")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_decisions"] == 0
    assert data["divergence_rate"] == 0.0
    assert data["window_days"] == 30


def test_get_calibration_with_data():
    """GET /reviewer/calibration returns correct aggregates."""
    repo = StubOutcomeRepo()
    import asyncio

    loop = asyncio.new_event_loop()
    loop.run_until_complete(
        repo.record(
            _make_outcome(
                owner_id="test-user",
                decision="auto_approved",
                actual_outcome="merged",
                confidence=0.9,
            )
        )
    )
    loop.run_until_complete(
        repo.record(
            _make_outcome(
                owner_id="test-user",
                decision="auto_approved",
                actual_outcome="reverted",
                confidence=0.7,
            )
        )
    )
    loop.run_until_complete(
        repo.record(
            _make_outcome(
                owner_id="test-user",
                decision="retried",
                confidence=0.5,
            )
        )
    )
    loop.close()

    client = TestClient(_build_app(repo))
    resp = client.get("/api/v1/tyr/reviewer/calibration")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_decisions"] == 3
    assert data["auto_approved"] == 2
    assert data["retried"] == 1
    assert data["escalated"] == 0


def test_get_calibration_custom_window():
    """GET /reviewer/calibration?window_days=7 passes the window param."""
    repo = StubOutcomeRepo()
    client = TestClient(_build_app(repo))
    resp = client.get("/api/v1/tyr/reviewer/calibration?window_days=7")
    assert resp.status_code == 200
    assert resp.json()["window_days"] == 7


# ---------------------------------------------------------------------------
# Outcome override endpoint tests
# ---------------------------------------------------------------------------


def test_override_outcome():
    """PATCH /raids/{tracker_id}/outcome resolves outcomes."""
    repo = StubOutcomeRepo()
    import asyncio

    loop = asyncio.new_event_loop()
    loop.run_until_complete(repo.record(_make_outcome(owner_id="test-user")))
    loop.close()

    client = TestClient(_build_app(repo))
    resp = client.patch(
        "/api/v1/tyr/raids/TRACKER-1/outcome",
        json={"actual_outcome": "merged", "notes": "manual override"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["tracker_id"] == "TRACKER-1"
    assert data["actual_outcome"] == "merged"
    assert data["resolved_count"] == 1


def test_override_outcome_invalid_value():
    """PATCH /raids/{tracker_id}/outcome rejects invalid outcome values."""
    repo = StubOutcomeRepo()
    client = TestClient(_build_app(repo))
    resp = client.patch(
        "/api/v1/tyr/raids/TRACKER-1/outcome",
        json={"actual_outcome": "invalid_value"},
    )
    assert resp.status_code == 422


def test_override_outcome_optional_notes():
    """PATCH /raids/{tracker_id}/outcome works without notes."""
    repo = StubOutcomeRepo()
    client = TestClient(_build_app(repo))
    resp = client.patch(
        "/api/v1/tyr/raids/TRACKER-1/outcome",
        json={"actual_outcome": "abandoned"},
    )
    assert resp.status_code == 200
    assert resp.json()["actual_outcome"] == "abandoned"


# ---------------------------------------------------------------------------
# Config endpoint tests
# ---------------------------------------------------------------------------


def test_get_tyr_config():
    """GET /config returns the reviewer system prompt."""
    repo = StubOutcomeRepo()
    client = TestClient(_build_app(repo))
    resp = client.get("/api/v1/tyr/config")
    assert resp.status_code == 200
    data = resp.json()
    assert "reviewer_system_prompt" in data
    assert isinstance(data["reviewer_system_prompt"], str)


def test_patch_tyr_config():
    """PATCH /config updates the reviewer system prompt."""
    repo = StubOutcomeRepo()
    app = _build_app(repo)
    client = TestClient(app)
    resp = client.patch(
        "/api/v1/tyr/config",
        json={"reviewer_system_prompt": "New prompt text"},
    )
    assert resp.status_code == 200
    assert resp.json()["reviewer_system_prompt"] == "New prompt text"

    # Verify persistence
    resp2 = client.get("/api/v1/tyr/config")
    assert resp2.json()["reviewer_system_prompt"] == "New prompt text"
