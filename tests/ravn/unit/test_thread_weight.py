"""Unit tests for the thread weight model (NIU-557).

Pure-function tests — no I/O, no mocks needed.
"""

from __future__ import annotations

from math import exp

import pytest

from ravn.domain.thread_weight import (
    ThreadWeightConfig,
    ThreadWeightSignals,
    compute_weight,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _zero_signals(age_days: float = 0.0) -> ThreadWeightSignals:
    return ThreadWeightSignals(
        age_days=age_days,
        mention_count=0,
        operator_engagement_count=0,
        peer_interest_count=0,
        sub_thread_count=0,
    )


# ---------------------------------------------------------------------------
# Importability
# ---------------------------------------------------------------------------


def test_importable() -> None:
    """ThreadWeightSignals, ThreadWeightConfig, and compute_weight are importable."""
    assert callable(compute_weight)
    assert ThreadWeightSignals is not None
    assert ThreadWeightConfig is not None


# ---------------------------------------------------------------------------
# Zero-signal decay
# ---------------------------------------------------------------------------


def test_zero_signals_day_0_weight_near_one() -> None:
    """With no engagement signals on day 0, weight should be ~1.0."""
    cfg = ThreadWeightConfig()
    signals = _zero_signals(age_days=0.0)
    weight = compute_weight(signals, cfg)
    assert abs(weight - 1.0) < 1e-9


def test_zero_signals_day_14_weight_near_half() -> None:
    """After 14 days of silence the weight should be ~0.5 (half-life target)."""
    cfg = ThreadWeightConfig()
    signals = _zero_signals(age_days=14.0)
    weight = compute_weight(signals, cfg)
    # exp(-0.05 * 14) ≈ 0.4966 — within 5% of 0.5
    assert 0.45 <= weight <= 0.55


def test_zero_signals_day_60_weight_near_zero() -> None:
    """After 60 days with no signals the weight should be close to 0."""
    cfg = ThreadWeightConfig()
    signals = _zero_signals(age_days=60.0)
    weight = compute_weight(signals, cfg)
    assert weight < 0.05


def test_weight_decreases_with_age() -> None:
    """Older threads with no new signals have strictly lower weight."""
    cfg = ThreadWeightConfig()
    w0 = compute_weight(_zero_signals(0.0), cfg)
    w7 = compute_weight(_zero_signals(7.0), cfg)
    w14 = compute_weight(_zero_signals(14.0), cfg)
    w30 = compute_weight(_zero_signals(30.0), cfg)
    assert w0 > w7 > w14 > w30


# ---------------------------------------------------------------------------
# Engagement offsets decay
# ---------------------------------------------------------------------------


def test_mentions_increase_weight() -> None:
    """Mention count adds a positive bonus on top of the recency score."""
    cfg = ThreadWeightConfig()
    base = compute_weight(_zero_signals(7.0), cfg)
    signals = ThreadWeightSignals(
        age_days=7.0,
        mention_count=3,
        operator_engagement_count=0,
        peer_interest_count=0,
        sub_thread_count=0,
    )
    weight = compute_weight(signals, cfg)
    assert weight == pytest.approx(base + 3 * cfg.mention_weight)
    assert weight > base


def test_operator_engagement_increases_weight() -> None:
    """Operator engagement adds its weighted bonus."""
    cfg = ThreadWeightConfig()
    base = compute_weight(_zero_signals(0.0), cfg)
    signals = ThreadWeightSignals(
        age_days=0.0,
        mention_count=0,
        operator_engagement_count=2,
        peer_interest_count=0,
        sub_thread_count=0,
    )
    weight = compute_weight(signals, cfg)
    assert weight == pytest.approx(base + 2 * cfg.engagement_weight)


def test_peer_interest_increases_weight() -> None:
    """Peer interest count adds its weighted bonus."""
    cfg = ThreadWeightConfig()
    base = compute_weight(_zero_signals(0.0), cfg)
    signals = ThreadWeightSignals(
        age_days=0.0,
        mention_count=0,
        operator_engagement_count=0,
        peer_interest_count=5,
        sub_thread_count=0,
    )
    weight = compute_weight(signals, cfg)
    assert weight == pytest.approx(base + 5 * cfg.peer_weight)


def test_sub_thread_count_increases_weight() -> None:
    """Sub-thread count adds its weighted bonus."""
    cfg = ThreadWeightConfig()
    base = compute_weight(_zero_signals(0.0), cfg)
    signals = ThreadWeightSignals(
        age_days=0.0,
        mention_count=0,
        operator_engagement_count=0,
        peer_interest_count=0,
        sub_thread_count=4,
    )
    weight = compute_weight(signals, cfg)
    assert weight == pytest.approx(base + 4 * cfg.sub_thread_weight)


def test_combined_signals_sum_correctly() -> None:
    """All signals combine additively on top of the recency score."""
    cfg = ThreadWeightConfig()
    signals = ThreadWeightSignals(
        age_days=10.0,
        mention_count=2,
        operator_engagement_count=1,
        peer_interest_count=3,
        sub_thread_count=2,
    )
    expected_bonus = (
        2 * cfg.mention_weight
        + 1 * cfg.engagement_weight
        + 3 * cfg.peer_weight
        + 2 * cfg.sub_thread_weight
    )
    expected_recency = cfg.recency_weight * exp(-cfg.decay_rate_per_day * 10.0)
    expected = max(0.0, expected_recency + expected_bonus)
    assert compute_weight(signals, cfg) == pytest.approx(expected)


# ---------------------------------------------------------------------------
# Weight is never negative
# ---------------------------------------------------------------------------


def test_weight_never_negative_with_default_config() -> None:
    """Weights are always >= 0 regardless of age."""
    cfg = ThreadWeightConfig()
    for age in [0, 30, 100, 365, 10_000]:
        weight = compute_weight(_zero_signals(float(age)), cfg)
        assert weight >= 0.0


def test_weight_never_negative_with_extreme_decay() -> None:
    """max(0.0, ...) clamps negative values even with adversarial config."""
    cfg = ThreadWeightConfig(
        decay_rate_per_day=100.0,
        recency_weight=-5.0,
        mention_weight=-1.0,
    )
    signals = ThreadWeightSignals(
        age_days=1.0,
        mention_count=1,
        operator_engagement_count=0,
        peer_interest_count=0,
        sub_thread_count=0,
    )
    weight = compute_weight(signals, cfg)
    assert weight == 0.0


# ---------------------------------------------------------------------------
# Default config behaviour
# ---------------------------------------------------------------------------


def test_default_config_used_when_none() -> None:
    """Passing config=None uses ThreadWeightConfig() defaults."""
    signals = _zero_signals(0.0)
    weight_explicit = compute_weight(signals, ThreadWeightConfig())
    weight_default = compute_weight(signals)
    assert weight_explicit == weight_default


def test_custom_config_overrides_defaults() -> None:
    """A custom decay rate changes the output."""
    signals = _zero_signals(14.0)
    default_weight = compute_weight(signals)
    fast_decay_cfg = ThreadWeightConfig(decay_rate_per_day=0.5)
    fast_weight = compute_weight(signals, fast_decay_cfg)
    assert fast_weight < default_weight


# ---------------------------------------------------------------------------
# Return type
# ---------------------------------------------------------------------------


def test_returns_float() -> None:
    """compute_weight always returns a plain float."""
    result = compute_weight(_zero_signals(0.0))
    assert isinstance(result, float)
