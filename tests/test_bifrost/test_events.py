"""Tests for the cost event emission system (NIU-484).

Covers:
- Port dataclasses (RequestCompletedEvent, BudgetWarningEvent)
- NullEventEmitter (silently drops all events)
- SleipnirEventEmitter (publishes to RabbitMQ; aio_pika mocked)
- _compute_budget_pct helper
- emit_cost_events integration helper
- End-to-end: events emitted via /v1/messages (non-streaming)
- EventsConfig added to BifrostConfig
- _build_event_emitter factory in app.py
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bifrost.adapters.events.null import NullEventEmitter
from bifrost.adapters.events.sleipnir import SleipnirEventEmitter
from bifrost.adapters.memory_store import MemoryUsageStore
from bifrost.app import _build_event_emitter, create_app
from bifrost.auth import AgentIdentity
from bifrost.config import (
    AgentPermissions,
    BifrostConfig,
    EventsConfig,
    ProviderConfig,
    QuotaConfig,
)
from bifrost.inbound.tracking import _compute_budget_pct, emit_cost_events
from bifrost.ports.events import BudgetWarningEvent, CostEventEmitter, RequestCompletedEvent
from bifrost.ports.usage_store import UsageRecord

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _identity(
    agent_id: str = "agent-1",
    tenant_id: str = "tenant-1",
    session_id: str = "sess-1",
    saga_id: str = "",
) -> AgentIdentity:
    return AgentIdentity(
        agent_id=agent_id,
        tenant_id=tenant_id,
        session_id=session_id,
        saga_id=saga_id,
    )


def _seeded_store(agent_id: str = "agent-1", cost: float = 0.0) -> MemoryUsageStore:
    store = MemoryUsageStore()
    if cost > 0.0:
        store._records.append(
            UsageRecord(
                request_id="seed",
                agent_id=agent_id,
                tenant_id="t",
                model="claude-sonnet-4-6",
                input_tokens=100,
                output_tokens=50,
                cost_usd=cost,
                timestamp=datetime.now(UTC),
            )
        )
    return store


# ---------------------------------------------------------------------------
# Port dataclasses
# ---------------------------------------------------------------------------


class TestEventDataclasses:
    def test_request_completed_defaults(self) -> None:
        ev = RequestCompletedEvent(
            agent_id="a",
            session_id="s",
            cost_usd=0.01,
            tokens_used=100,
            budget_pct_remaining=80.0,
            model="claude-sonnet-4-6",
        )
        assert ev.type == "bifrost.cost.request_completed"
        assert ev.timestamp  # auto-populated

    def test_budget_warning_defaults(self) -> None:
        ev = BudgetWarningEvent(
            agent_id="a",
            budget_pct_remaining=15.0,
            daily_limit_usd=5.0,
            spent_usd=4.25,
        )
        assert ev.type == "bifrost.cost.budget_warning"


# ---------------------------------------------------------------------------
# _compute_budget_pct
# ---------------------------------------------------------------------------


class TestComputeBudgetPct:
    def test_unlimited_returns_100(self) -> None:
        assert _compute_budget_pct(9999.0, 0.0) == 100.0

    def test_half_spent(self) -> None:
        assert _compute_budget_pct(2.5, 5.0) == pytest.approx(50.0)

    def test_fully_spent_clamps_to_zero(self) -> None:
        assert _compute_budget_pct(5.0, 5.0) == pytest.approx(0.0)

    def test_overspent_clamps_to_zero(self) -> None:
        assert _compute_budget_pct(6.0, 5.0) == pytest.approx(0.0)

    def test_nothing_spent(self) -> None:
        assert _compute_budget_pct(0.0, 10.0) == pytest.approx(100.0)


# ---------------------------------------------------------------------------
# NullEventEmitter
# ---------------------------------------------------------------------------


class TestNullEventEmitter:
    @pytest.mark.asyncio
    async def test_emit_request_completed_is_noop(self) -> None:
        emitter = NullEventEmitter()
        ev = RequestCompletedEvent(
            agent_id="a",
            session_id="s",
            cost_usd=0.01,
            tokens_used=100,
            budget_pct_remaining=90.0,
            model="gpt-4o",
        )
        # Should not raise
        await emitter.emit_request_completed(ev)

    @pytest.mark.asyncio
    async def test_emit_budget_warning_is_noop(self) -> None:
        emitter = NullEventEmitter()
        ev = BudgetWarningEvent(
            agent_id="a",
            budget_pct_remaining=10.0,
            daily_limit_usd=5.0,
            spent_usd=4.5,
        )
        await emitter.emit_budget_warning(ev)

    @pytest.mark.asyncio
    async def test_close_is_noop(self) -> None:
        emitter = NullEventEmitter()
        await emitter.close()

    def test_is_cost_event_emitter(self) -> None:
        assert isinstance(NullEventEmitter(), CostEventEmitter)


# ---------------------------------------------------------------------------
# SleipnirEventEmitter
# ---------------------------------------------------------------------------


def _mock_aio_pika() -> MagicMock:
    """Return a fake aio_pika module for use in sys.modules patching."""
    mock = MagicMock()
    mock.DeliveryMode.PERSISTENT = 2
    mock.Message.return_value = MagicMock()
    mock.ExchangeType = MagicMock(side_effect=lambda x: x)
    return mock


class TestSleipnirEventEmitter:
    def test_is_cost_event_emitter(self) -> None:
        assert isinstance(SleipnirEventEmitter(url="amqp://localhost/"), CostEventEmitter)

    @pytest.mark.asyncio
    async def test_emit_request_completed_publishes_message(self) -> None:
        emitter = SleipnirEventEmitter(url="amqp://localhost/")
        mock_exchange = AsyncMock()
        emitter._exchange = mock_exchange
        emitter._healthy = True

        ev = RequestCompletedEvent(
            agent_id="agent-1",
            session_id="sess-1",
            cost_usd=0.0042,
            tokens_used=1240,
            budget_pct_remaining=64.2,
            model="claude-sonnet-4-6",
        )

        with patch.dict(sys.modules, {"aio_pika": _mock_aio_pika()}):
            await emitter.emit_request_completed(ev)

        mock_exchange.publish.assert_awaited_once()
        routing_key = mock_exchange.publish.call_args[1]["routing_key"]
        assert routing_key == "bifrost.cost.request_completed"

    @pytest.mark.asyncio
    async def test_emit_budget_warning_publishes_message(self) -> None:
        emitter = SleipnirEventEmitter(url="amqp://localhost/")
        mock_exchange = AsyncMock()
        emitter._exchange = mock_exchange
        emitter._healthy = True

        ev = BudgetWarningEvent(
            agent_id="agent-1",
            budget_pct_remaining=18.5,
            daily_limit_usd=5.0,
            spent_usd=4.07,
        )

        with patch.dict(sys.modules, {"aio_pika": _mock_aio_pika()}):
            await emitter.emit_budget_warning(ev)

        mock_exchange.publish.assert_awaited_once()
        routing_key = mock_exchange.publish.call_args[1]["routing_key"]
        assert routing_key == "bifrost.cost.budget_warning"

    @pytest.mark.asyncio
    async def test_drops_event_when_not_connected_and_connect_fails(self) -> None:
        emitter = SleipnirEventEmitter(url="amqp://bad-host/")
        mock_aio = _mock_aio_pika()
        mock_aio.connect_robust = AsyncMock(side_effect=ConnectionError("refused"))

        ev = RequestCompletedEvent(
            agent_id="a",
            session_id="s",
            cost_usd=0.01,
            tokens_used=10,
            budget_pct_remaining=100.0,
            model="gpt-4o",
        )
        with patch.dict(sys.modules, {"aio_pika": mock_aio}):
            # Should not raise; event is dropped with a warning log
            await emitter.emit_request_completed(ev)

        assert not emitter._healthy

    @pytest.mark.asyncio
    async def test_publish_error_marks_unhealthy(self) -> None:
        emitter = SleipnirEventEmitter(url="amqp://localhost/")
        mock_exchange = AsyncMock()
        mock_exchange.publish = AsyncMock(side_effect=RuntimeError("channel closed"))
        emitter._exchange = mock_exchange
        emitter._healthy = True

        ev = RequestCompletedEvent(
            agent_id="a",
            session_id="s",
            cost_usd=0.01,
            tokens_used=10,
            budget_pct_remaining=100.0,
            model="gpt-4o",
        )
        with patch.dict(sys.modules, {"aio_pika": _mock_aio_pika()}):
            await emitter.emit_request_completed(ev)

        assert not emitter._healthy

    @pytest.mark.asyncio
    async def test_close_resets_state(self) -> None:
        emitter = SleipnirEventEmitter(url="amqp://localhost/")
        mock_conn = AsyncMock()
        emitter._connection = mock_conn
        emitter._healthy = True

        await emitter.close()

        mock_conn.close.assert_awaited_once()
        assert not emitter._healthy
        assert emitter._connection is None


# ---------------------------------------------------------------------------
# emit_cost_events helper
# ---------------------------------------------------------------------------


class TestEmitCostEvents:
    @pytest.mark.asyncio
    async def test_emits_request_completed_always(self) -> None:
        emitter = NullEventEmitter()
        emitter.emit_request_completed = AsyncMock()
        emitter.emit_budget_warning = AsyncMock()

        store = _seeded_store(cost=1.0)
        identity = _identity()

        await emit_cost_events(
            emitter=emitter,
            store=store,
            identity=identity,
            cost=0.01,
            tokens_used=200,
            model="claude-sonnet-4-6",
            agent_budget_limit=0.0,  # unlimited
            budget_warning_threshold_pct=20.0,
        )

        emitter.emit_request_completed.assert_awaited_once()
        emitter.emit_budget_warning.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_emits_budget_warning_when_threshold_crossed(self) -> None:
        emitter = NullEventEmitter()
        emitter.emit_request_completed = AsyncMock()
        emitter.emit_budget_warning = AsyncMock()

        # Agent has spent $4.50 of $5.00 limit → 10% remaining (below 20% threshold)
        store = _seeded_store(cost=4.50)
        identity = _identity()

        await emit_cost_events(
            emitter=emitter,
            store=store,
            identity=identity,
            cost=0.0,
            tokens_used=0,
            model="claude-sonnet-4-6",
            agent_budget_limit=5.0,
            budget_warning_threshold_pct=20.0,
        )

        emitter.emit_request_completed.assert_awaited_once()
        emitter.emit_budget_warning.assert_awaited_once()

        warning_event = emitter.emit_budget_warning.call_args[0][0]
        assert isinstance(warning_event, BudgetWarningEvent)
        assert warning_event.daily_limit_usd == 5.0
        assert warning_event.budget_pct_remaining == pytest.approx(10.0)

    @pytest.mark.asyncio
    async def test_no_budget_warning_when_above_threshold(self) -> None:
        emitter = NullEventEmitter()
        emitter.emit_request_completed = AsyncMock()
        emitter.emit_budget_warning = AsyncMock()

        # 50% remaining — above 20% threshold
        store = _seeded_store(cost=2.50)
        identity = _identity()

        await emit_cost_events(
            emitter=emitter,
            store=store,
            identity=identity,
            cost=0.0,
            tokens_used=0,
            model="gpt-4o",
            agent_budget_limit=5.0,
            budget_warning_threshold_pct=20.0,
        )

        emitter.emit_budget_warning.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_request_completed_payload(self) -> None:
        captured: list[RequestCompletedEvent] = []

        class CapturingEmitter(CostEventEmitter):
            async def emit_request_completed(self, event: RequestCompletedEvent) -> None:
                captured.append(event)

            async def emit_budget_warning(self, event: BudgetWarningEvent) -> None:
                pass

        store = MemoryUsageStore()
        identity = _identity(agent_id="agt", session_id="sess-abc")

        await emit_cost_events(
            emitter=CapturingEmitter(),
            store=store,
            identity=identity,
            cost=0.0042,
            tokens_used=1240,
            model="claude-sonnet-4-6",
            agent_budget_limit=0.0,
            budget_warning_threshold_pct=20.0,
        )

        assert len(captured) == 1
        ev = captured[0]
        assert ev.agent_id == "agt"
        assert ev.session_id == "sess-abc"
        assert ev.cost_usd == pytest.approx(0.0042)
        assert ev.tokens_used == 1240
        assert ev.model == "claude-sonnet-4-6"
        assert ev.budget_pct_remaining == pytest.approx(100.0)  # unlimited


# ---------------------------------------------------------------------------
# EventsConfig + BifrostConfig
# ---------------------------------------------------------------------------


class TestEventsConfig:
    def test_defaults(self) -> None:
        cfg = EventsConfig()
        assert cfg.adapter == "null"
        assert cfg.exchange == "bifrost.events"
        assert cfg.budget_warning_threshold_pct == 20.0

    def test_embedded_in_bifrost_config(self) -> None:
        cfg = BifrostConfig()
        assert isinstance(cfg.events, EventsConfig)

    def test_sleipnir_config(self) -> None:
        cfg = EventsConfig(adapter="sleipnir", url="amqp://rabbit/")
        assert cfg.adapter == "sleipnir"
        assert cfg.url == "amqp://rabbit/"


# ---------------------------------------------------------------------------
# _build_event_emitter factory
# ---------------------------------------------------------------------------


class TestBuildEventEmitter:
    def test_null_adapter_by_default(self) -> None:
        cfg = BifrostConfig()
        emitter = _build_event_emitter(cfg)
        assert isinstance(emitter, NullEventEmitter)

    def test_sleipnir_adapter_when_configured(self) -> None:
        cfg = BifrostConfig(events=EventsConfig(adapter="sleipnir", url="amqp://localhost/"))
        emitter = _build_event_emitter(cfg)
        assert isinstance(emitter, SleipnirEventEmitter)

    def test_unknown_adapter_falls_back_to_null(self) -> None:
        cfg = BifrostConfig(events=EventsConfig(adapter="unknown"))
        emitter = _build_event_emitter(cfg)
        assert isinstance(emitter, NullEventEmitter)


# ---------------------------------------------------------------------------
# End-to-end: /v1/messages emits events
# ---------------------------------------------------------------------------


class TestEndToEndEventEmission:
    @pytest.mark.asyncio
    async def test_non_streaming_request_emits_request_completed(self) -> None:
        from fastapi.testclient import TestClient

        from bifrost.translation.models import AnthropicResponse, TextBlock, UsageInfo

        captured_completed: list[RequestCompletedEvent] = []
        captured_warnings: list[BudgetWarningEvent] = []

        class CapturingEmitter(CostEventEmitter):
            async def emit_request_completed(self, event: RequestCompletedEvent) -> None:
                captured_completed.append(event)

            async def emit_budget_warning(self, event: BudgetWarningEvent) -> None:
                captured_warnings.append(event)

        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
        )
        mock_response = AnthropicResponse(
            id="msg_test",
            content=[TextBlock(text="hi")],
            model="claude-sonnet-4-6",
            stop_reason="end_turn",
            usage=UsageInfo(input_tokens=10, output_tokens=5),
        )

        # Inject capturing emitter into the router's closure via patching
        with (
            patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as mock_complete,
            patch("bifrost.app._build_event_emitter", return_value=CapturingEmitter()),
        ):
            mock_complete.return_value = mock_response
            app2 = create_app(cfg)
            with TestClient(app2) as client:
                resp = client.post(
                    "/v1/messages",
                    json={
                        "model": "claude-sonnet-4-6",
                        "max_tokens": 100,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )

        assert resp.status_code == 200
        assert len(captured_completed) == 1
        ev = captured_completed[0]
        assert ev.model == "claude-sonnet-4-6"
        assert ev.tokens_used == 15  # 10 + 5
        assert ev.type == "bifrost.cost.request_completed"

    @pytest.mark.asyncio
    async def test_budget_warning_emitted_when_near_limit(self) -> None:
        from fastapi.testclient import TestClient

        from bifrost.translation.models import AnthropicResponse, TextBlock, UsageInfo

        captured_warnings: list[BudgetWarningEvent] = []

        class WarningCapturingEmitter(CostEventEmitter):
            async def emit_request_completed(self, event: RequestCompletedEvent) -> None:
                pass

            async def emit_budget_warning(self, event: BudgetWarningEvent) -> None:
                captured_warnings.append(event)

        # Agent has a $1.00 daily limit; store already has $0.95 spent
        cfg = BifrostConfig(
            providers={"anthropic": ProviderConfig(models=["claude-sonnet-4-6"])},
            agent_permissions={
                "agent-x": AgentPermissions(quota=QuotaConfig(max_cost_per_day=1.0))
            },
            events=EventsConfig(budget_warning_threshold_pct=20.0),
        )
        mock_response = AnthropicResponse(
            id="msg_test",
            content=[TextBlock(text="hi")],
            model="claude-sonnet-4-6",
            stop_reason="end_turn",
            usage=UsageInfo(input_tokens=10, output_tokens=5),
        )

        with (
            patch("bifrost.router.ModelRouter.complete", new_callable=AsyncMock) as mock_complete,
            patch("bifrost.app._build_event_emitter", return_value=WarningCapturingEmitter()),
            patch(
                "bifrost.adapters.memory_store.MemoryUsageStore.agent_cost_today",
                new_callable=AsyncMock,
                return_value=0.95,
            ),
        ):
            mock_complete.return_value = mock_response
            app = create_app(cfg)
            with TestClient(app) as client:
                resp = client.post(
                    "/v1/messages",
                    json={
                        "model": "claude-sonnet-4-6",
                        "max_tokens": 100,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                    headers={"X-Agent-ID": "agent-x"},
                )

        assert resp.status_code == 200
        assert len(captured_warnings) == 1
        w = captured_warnings[0]
        assert w.agent_id == "agent-x"
        assert w.daily_limit_usd == 1.0
