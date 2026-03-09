"""Tests for the cost tracker worker."""

from __future__ import annotations

from datetime import UTC, datetime

from volundr.bifrost.models import SynapseEnvelope
from volundr.bifrost.proxy import METRICS_TOPIC
from volundr.bifrost.workers.cost_tracker import CostTracker

from .conftest import MockSynapse


def _make_metrics_envelope(
    *,
    session_id: str = "session-1",
    model: str = "claude-sonnet-4-5-20250929",
    input_tokens: int = 100,
    output_tokens: int = 50,
    cost_estimate_usd: float | None = None,
) -> SynapseEnvelope:
    return SynapseEnvelope(
        topic=METRICS_TOPIC,
        session_id=session_id,
        project_id=None,
        timestamp=datetime.now(UTC),
        trace_id="trace-1",
        payload={
            "session_id": session_id,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_estimate_usd": cost_estimate_usd,
            "upstream": "anthropic",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )


class TestCostTracker:
    async def test_tracks_single_turn(self, mock_synapse: MockSynapse):
        tracker = CostTracker(mock_synapse)
        await tracker.start()

        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(input_tokens=100, output_tokens=50),
        )

        cost = tracker.get_session_cost("session-1")
        assert cost is not None
        assert cost.total_input_tokens == 100
        assert cost.total_output_tokens == 50
        assert cost.turn_count == 1
        assert "claude-sonnet-4-5-20250929" in cost.models_used

    async def test_accumulates_multiple_turns(self, mock_synapse: MockSynapse):
        tracker = CostTracker(mock_synapse)
        await tracker.start()

        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(input_tokens=100, output_tokens=50),
        )
        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(input_tokens=200, output_tokens=80),
        )

        cost = tracker.get_session_cost("session-1")
        assert cost is not None
        assert cost.total_input_tokens == 300
        assert cost.total_output_tokens == 130
        assert cost.turn_count == 2

    async def test_tracks_multiple_sessions_independently(self, mock_synapse: MockSynapse):
        tracker = CostTracker(mock_synapse)
        await tracker.start()

        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(session_id="session-a", input_tokens=100, output_tokens=50),
        )
        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(session_id="session-b", input_tokens=200, output_tokens=80),
        )

        cost_a = tracker.get_session_cost("session-a")
        cost_b = tracker.get_session_cost("session-b")

        assert cost_a is not None
        assert cost_a.total_input_tokens == 100
        assert cost_b is not None
        assert cost_b.total_input_tokens == 200

    async def test_tracks_unique_models(self, mock_synapse: MockSynapse):
        tracker = CostTracker(mock_synapse)
        await tracker.start()

        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(model="claude-sonnet-4-5-20250929"),
        )
        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(model="claude-opus-4-5-20250929"),
        )
        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(model="claude-sonnet-4-5-20250929"),
        )

        cost = tracker.get_session_cost("session-1")
        assert cost is not None
        assert cost.models_used == {"claude-sonnet-4-5-20250929", "claude-opus-4-5-20250929"}

    async def test_accumulates_cost(self, mock_synapse: MockSynapse):
        tracker = CostTracker(mock_synapse)
        await tracker.start()

        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(cost_estimate_usd=0.05),
        )
        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(cost_estimate_usd=0.10),
        )

        cost = tracker.get_session_cost("session-1")
        assert cost is not None
        assert abs(cost.total_cost_usd - 0.15) < 1e-9

    async def test_get_nonexistent_session_returns_none(self, mock_synapse: MockSynapse):
        tracker = CostTracker(mock_synapse)
        await tracker.start()

        assert tracker.get_session_cost("nonexistent") is None

    async def test_get_all_sessions(self, mock_synapse: MockSynapse):
        tracker = CostTracker(mock_synapse)
        await tracker.start()

        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(session_id="s1"),
        )
        await mock_synapse.publish(
            METRICS_TOPIC,
            _make_metrics_envelope(session_id="s2"),
        )

        all_sessions = tracker.get_all_sessions()
        assert "s1" in all_sessions
        assert "s2" in all_sessions
