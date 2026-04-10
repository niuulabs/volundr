"""Tests for the Thread domain models (NIU-555)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from ravn.domain.thread import (
    RavnThread,
    ThreadStatus,
    ThreadWeight,
    compute_weight,
)


class TestRavnThreadCreate:
    def test_generates_uuid(self) -> None:
        t = RavnThread.create(
            page_path="papers/foo.md",
            title="Foo Paper",
            weight=0.5,
            next_action="read it",
        )
        assert len(t.thread_id) == 36  # UUID4 string
        assert t.thread_id.count("-") == 4

    def test_defaults(self) -> None:
        t = RavnThread.create(
            page_path="papers/foo.md",
            title="Foo Paper",
            weight=0.5,
            next_action="read it",
        )
        assert t.status == ThreadStatus.OPEN
        assert t.tags == []
        assert t.page_path == "papers/foo.md"
        assert t.title == "Foo Paper"
        assert t.weight == 0.5
        assert t.next_action == "read it"

    def test_custom_tags(self) -> None:
        t = RavnThread.create(
            page_path="papers/foo.md",
            title="Foo",
            weight=0.7,
            next_action="analyse",
            tags=["ml", "paper"],
        )
        assert t.tags == ["ml", "paper"]

    def test_timestamps_utc(self) -> None:
        t = RavnThread.create(
            page_path="papers/foo.md",
            title="Foo",
            weight=0.5,
            next_action="",
        )
        assert t.created_at.tzinfo is not None
        assert t.last_seen_at.tzinfo is not None


class TestThreadStatus:
    def test_open_value(self) -> None:
        assert ThreadStatus.OPEN == "open"

    def test_closed_value(self) -> None:
        assert ThreadStatus.CLOSED == "closed"


class TestComputeWeight:
    def test_brand_new_thread_recency_near_one(self) -> None:
        now = datetime.now(UTC)
        tw = compute_weight(
            base_score=0.8,
            importance_factor=1.0,
            created_at=now,
            half_life_days=7.0,
            reference_time=now,
        )
        # recency_factor should be very close to 1.0 for 0-day-old thread
        assert tw.recency_factor > 0.99
        assert abs(tw.composite - 0.8) < 0.01

    def test_half_life_halves_recency(self) -> None:
        now = datetime.now(UTC)
        seven_days_ago = now - timedelta(days=7)
        tw = compute_weight(
            base_score=1.0,
            importance_factor=1.0,
            created_at=seven_days_ago,
            half_life_days=7.0,
            reference_time=now,
        )
        assert abs(tw.recency_factor - 0.5) < 0.01

    def test_composite_formula(self) -> None:
        now = datetime.now(UTC)
        tw = compute_weight(
            base_score=0.6,
            importance_factor=0.8,
            created_at=now,
            half_life_days=7.0,
            reference_time=now,
        )
        expected = 0.6 * 1.0 * 0.8  # recency ≈ 1.0 for brand-new
        assert abs(tw.composite - expected) < 0.01

    def test_older_thread_has_lower_weight_than_newer(self) -> None:
        now = datetime.now(UTC)
        tw_new = compute_weight(
            base_score=0.5,
            importance_factor=1.0,
            created_at=now,
            half_life_days=7.0,
            reference_time=now,
        )
        tw_old = compute_weight(
            base_score=0.5,
            importance_factor=1.0,
            created_at=now - timedelta(days=30),
            half_life_days=7.0,
            reference_time=now,
        )
        assert tw_new.composite > tw_old.composite

    def test_naive_datetime_handled(self) -> None:
        naive_dt = datetime(2025, 1, 1, 12, 0, 0)  # no tzinfo
        now = datetime.now(UTC)
        # Should not raise
        tw = compute_weight(
            base_score=0.5,
            importance_factor=1.0,
            created_at=naive_dt,
            half_life_days=7.0,
            reference_time=now,
        )
        assert isinstance(tw, ThreadWeight)
        assert tw.composite >= 0.0

    def test_very_old_thread_near_zero(self) -> None:
        now = datetime.now(UTC)
        very_old = now - timedelta(days=365)
        tw = compute_weight(
            base_score=1.0,
            importance_factor=1.0,
            created_at=very_old,
            half_life_days=7.0,
            reference_time=now,
        )
        assert tw.composite < 0.001

    def test_default_reference_time(self) -> None:
        """compute_weight uses datetime.now(UTC) when reference_time is None."""
        now = datetime.now(UTC)
        tw = compute_weight(
            base_score=1.0,
            importance_factor=1.0,
            created_at=now,
        )
        assert isinstance(tw, ThreadWeight)

    def test_returns_threadweight_dataclass(self) -> None:
        now = datetime.now(UTC)
        tw = compute_weight(
            base_score=0.5,
            importance_factor=0.9,
            created_at=now,
            reference_time=now,
        )
        assert isinstance(tw, ThreadWeight)
        assert tw.base_score == 0.5
        assert tw.importance_factor == 0.9
        assert tw.computed_at == now
