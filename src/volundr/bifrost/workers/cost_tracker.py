"""Cost tracker worker — aggregates per-session token and cost metrics."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from volundr.bifrost.models import SynapseEnvelope
from volundr.bifrost.ports import Synapse
from volundr.bifrost.proxy import METRICS_TOPIC

logger = logging.getLogger(__name__)


@dataclass
class SessionCost:
    """Accumulated cost for a single session."""

    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cost_usd: float = 0.0
    turn_count: int = 0
    models_used: set[str] = field(default_factory=set)


class CostTracker:
    """Subscribes to ``bifrost.metrics`` and aggregates per-session costs.

    Phase A: observability only — logs summaries after each turn.
    Phase E adds budget enforcement on top of these aggregates.
    """

    def __init__(self, synapse: Synapse) -> None:
        self._synapse = synapse
        self._sessions: dict[str, SessionCost] = {}

    async def start(self) -> None:
        await self._synapse.subscribe(METRICS_TOPIC, self._on_metrics)

    async def _on_metrics(self, envelope: SynapseEnvelope) -> None:
        payload = envelope.payload
        session_id = payload.get("session_id") or "unknown"
        model = payload.get("model", "unknown")
        input_tokens = payload.get("input_tokens", 0)
        output_tokens = payload.get("output_tokens", 0)
        cost = payload.get("cost_estimate_usd") or 0.0

        session = self._sessions.setdefault(session_id, SessionCost())
        session.total_input_tokens += input_tokens
        session.total_output_tokens += output_tokens
        session.total_cost_usd += cost
        session.turn_count += 1
        session.models_used.add(model)

        logger.info(
            "bifrost.cost session=%s turn=%d model=%s "
            "in=%d out=%d cumulative_in=%d cumulative_out=%d",
            session_id,
            session.turn_count,
            model,
            input_tokens,
            output_tokens,
            session.total_input_tokens,
            session.total_output_tokens,
        )

    def get_session_cost(self, session_id: str) -> SessionCost | None:
        return self._sessions.get(session_id)

    def get_all_sessions(self) -> dict[str, SessionCost]:
        return dict(self._sessions)
