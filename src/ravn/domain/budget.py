"""Daily budget tracker for per-Ravn API cost accounting (NIU-570).

Tracks USD spend per UTC calendar day and gates new initiative tasks when the
configured daily cap is reached.  Resets automatically at the UTC day boundary.
"""

from __future__ import annotations

from datetime import UTC, date, datetime


class DailyBudgetTracker:
    """Tracks USD spend per UTC day and gates tasks when the cap is reached.

    Usage::

        tracker = DailyBudgetTracker(daily_cap_usd=1.0, warn_at_percent=80)

        if not tracker.can_spend():
            # skip task — budget exhausted for today
            ...

        tracker.record(outcome.cost_usd)

        if tracker.warn_threshold_reached:
            # publish warning event
            ...
    """

    def __init__(self, daily_cap_usd: float = 1.0, warn_at_percent: int = 80) -> None:
        self._daily_cap_usd = daily_cap_usd
        self._warn_at_percent = warn_at_percent
        self._spent_today: float = 0.0
        self._current_date: date = datetime.now(UTC).date()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _maybe_reset(self) -> None:
        """Reset spend counter if the UTC calendar day has rolled over."""
        today = datetime.now(UTC).date()
        if today != self._current_date:
            self._spent_today = 0.0
            self._current_date = today

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def record(self, cost_usd: float) -> None:
        """Add spend from a completed task."""
        self._maybe_reset()
        self._spent_today += cost_usd

    def can_spend(self, estimated_cost_usd: float = 0.0) -> bool:
        """Return True if adding *estimated_cost_usd* keeps us within the cap.

        When *estimated_cost_usd* is 0.0 (default) simply checks whether the
        cap has already been reached.
        """
        self._maybe_reset()
        if self._daily_cap_usd <= 0:
            return False
        return self._spent_today + estimated_cost_usd < self._daily_cap_usd

    @property
    def spent_today_usd(self) -> float:
        """USD spent so far today (resets at UTC midnight)."""
        self._maybe_reset()
        return self._spent_today

    @property
    def remaining_usd(self) -> float:
        """USD remaining before the daily cap is hit (never negative)."""
        self._maybe_reset()
        return max(0.0, self._daily_cap_usd - self._spent_today)

    @property
    def warn_threshold_reached(self) -> bool:
        """True when spend has crossed the *warn_at_percent* threshold."""
        self._maybe_reset()
        if self._daily_cap_usd <= 0:
            return False
        pct = (self._spent_today / self._daily_cap_usd) * 100
        return pct >= self._warn_at_percent
