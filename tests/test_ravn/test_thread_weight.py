"""Unit tests for ravn.domain.thread_weight (NIU-564).

Pure-function tests — no I/O, no mocks.
Covers compute_weight with zero signals at day 0 and key weight model behaviour.
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
# Zero signals at day 0 — primary acceptance criterion
# ---------------------------------------------------------------------------


class TestZeroSignalsDay0:
    def test_weight_approx_one(self) -> None:
        """With zero engagement signals on day 0, weight ≈ 1.0."""
        signals = _zero_signals(age_days=0.0)
        weight = compute_weight(signals)
        assert abs(weight - 1.0) < 1e-9

    def test_weight_is_float(self) -> None:
        weight = compute_weight(_zero_signals())
        assert isinstance(weight, float)

    def test_weight_non_negative(self) -> None:
        weight = compute_weight(_zero_signals())
        assert weight >= 0.0

    def test_default_config_gives_same_result_as_explicit_default(self) -> None:
        signals = _zero_signals()
        assert compute_weight(signals) == compute_weight(signals, ThreadWeightConfig())

    def test_zero_signals_with_explicit_default_config(self) -> None:
        cfg = ThreadWeightConfig()
        weight = compute_weight(_zero_signals(0.0), cfg)
        expected = cfg.recency_weight * exp(-cfg.decay_rate_per_day * 0.0)
        assert weight == pytest.approx(expected)


# ---------------------------------------------------------------------------
# Decay over time
# ---------------------------------------------------------------------------


class TestDecayOverTime:
    def test_weight_decreases_with_age(self) -> None:
        cfg = ThreadWeightConfig()
        w0 = compute_weight(_zero_signals(0.0), cfg)
        w7 = compute_weight(_zero_signals(7.0), cfg)
        w14 = compute_weight(_zero_signals(14.0), cfg)
        assert w0 > w7 > w14

    def test_half_life_approximately_14_days(self) -> None:
        cfg = ThreadWeightConfig()
        w14 = compute_weight(_zero_signals(14.0), cfg)
        assert 0.45 <= w14 <= 0.55

    def test_weight_near_zero_after_60_days(self) -> None:
        weight = compute_weight(_zero_signals(60.0))
        assert weight < 0.05

    def test_weight_never_negative(self) -> None:
        for age in (0, 14, 60, 365):
            assert compute_weight(_zero_signals(float(age))) >= 0.0


# ---------------------------------------------------------------------------
# Signal bonuses
# ---------------------------------------------------------------------------


class TestSignalBonuses:
    def test_mentions_increase_weight(self) -> None:
        cfg = ThreadWeightConfig()
        base = compute_weight(_zero_signals(0.0), cfg)
        signals = ThreadWeightSignals(
            age_days=0.0,
            mention_count=3,
            operator_engagement_count=0,
            peer_interest_count=0,
            sub_thread_count=0,
        )
        assert compute_weight(signals, cfg) == pytest.approx(base + 3 * cfg.mention_weight)

    def test_operator_engagement_increases_weight(self) -> None:
        cfg = ThreadWeightConfig()
        base = compute_weight(_zero_signals(0.0), cfg)
        signals = ThreadWeightSignals(
            age_days=0.0,
            mention_count=0,
            operator_engagement_count=1,
            peer_interest_count=0,
            sub_thread_count=0,
        )
        assert compute_weight(signals, cfg) == pytest.approx(base + 1 * cfg.engagement_weight)

    def test_peer_interest_increases_weight(self) -> None:
        cfg = ThreadWeightConfig()
        base = compute_weight(_zero_signals(0.0), cfg)
        signals = ThreadWeightSignals(
            age_days=0.0,
            mention_count=0,
            operator_engagement_count=0,
            peer_interest_count=4,
            sub_thread_count=0,
        )
        assert compute_weight(signals, cfg) == pytest.approx(base + 4 * cfg.peer_weight)

    def test_sub_thread_increases_weight(self) -> None:
        cfg = ThreadWeightConfig()
        base = compute_weight(_zero_signals(0.0), cfg)
        signals = ThreadWeightSignals(
            age_days=0.0,
            mention_count=0,
            operator_engagement_count=0,
            peer_interest_count=0,
            sub_thread_count=2,
        )
        assert compute_weight(signals, cfg) == pytest.approx(base + 2 * cfg.sub_thread_weight)
