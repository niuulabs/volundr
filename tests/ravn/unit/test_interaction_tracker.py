"""Unit tests for LastInteractionTracker."""

from __future__ import annotations

from datetime import UTC, datetime

from ravn.domain.interaction_tracker import LastInteractionTracker


class TestLastInteractionTracker:
    """Tests for the LastInteractionTracker domain object."""

    def test_initial_state_is_none(self) -> None:
        tracker = LastInteractionTracker()
        assert tracker.last() is None

    def test_touch_records_timestamp(self) -> None:
        tracker = LastInteractionTracker()
        before = datetime.now(UTC)
        tracker.touch()
        after = datetime.now(UTC)

        last = tracker.last()
        assert last is not None
        assert before <= last <= after

    def test_touch_updates_timestamp(self) -> None:
        tracker = LastInteractionTracker()
        tracker.touch()
        first = tracker.last()

        tracker.touch()
        second = tracker.last()

        assert first is not None
        assert second is not None
        assert second >= first

    def test_last_returns_copy_safe_value(self) -> None:
        tracker = LastInteractionTracker()
        tracker.touch()

        a = tracker.last()
        b = tracker.last()
        assert a == b
