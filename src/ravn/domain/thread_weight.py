"""Thread weight model for Ravn.

Pure functions — no I/O, no side effects.

Ravn computes thread weights from raw signals; Mímir stores the result
(``thread_weight``) and the raw signals (``thread_weight_signals``) opaquely
in page frontmatter without interpreting them.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import exp


@dataclass(frozen=True)
class ThreadWeightSignals:
    """Raw signals fed into the weight model.

    Ravn computes these; Mímir stores them as an opaque dict in
    ``thread_weight_signals``.
    """

    age_days: float
    mention_count: int
    operator_engagement_count: int
    peer_interest_count: int
    sub_thread_count: int


@dataclass(frozen=True)
class ThreadWeightConfig:
    """Tunable knobs for the weight formula.

    Defaults are the domain starting point.  The live config comes from
    ``ThreadConfig`` in ``src/ravn/config.py`` (NIU-558) and overrides these.

    Calibration target:
    - weight ~1.0 on day 0 with no signals
    - weight ~0.5 after 14 days of silence
    - weight near 0 after 60 days of silence
    """

    decay_rate_per_day: float = 0.05  # half-life ~14 days
    recency_weight: float = 1.0
    mention_weight: float = 0.3
    engagement_weight: float = 0.5
    peer_weight: float = 0.2
    sub_thread_weight: float = 0.4


def compute_weight(
    signals: ThreadWeightSignals,
    config: ThreadWeightConfig | None = None,
) -> float:
    """Compute a thread's weight from its signals.

    Args:
        signals: Raw engagement signals for the thread.
        config:  Weight formula configuration.  Defaults to
                 :class:`ThreadWeightConfig` with domain defaults when omitted.

    Returns:
        Non-negative float representing thread engagement weight.
    """
    if config is None:
        config = ThreadWeightConfig()

    bonus = (
        signals.mention_count * config.mention_weight
        + signals.operator_engagement_count * config.engagement_weight
        + signals.peer_interest_count * config.peer_weight
        + signals.sub_thread_count * config.sub_thread_weight
    )

    recency_score = config.recency_weight * exp(-config.decay_rate_per_day * signals.age_days)

    return max(0.0, recency_score + bonus)
