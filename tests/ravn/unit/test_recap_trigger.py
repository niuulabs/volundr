"""Unit tests for RecapTrigger (NIU-569).

Covers:
- Disabled trigger exits immediately
- Operator returns after >1h absence → recap fires
- Operator returns after <1h → no recap (short break)
- No closed threads since last recap → recap skipped
- Recap enqueued with OutputMode.SURFACE and priority=1
- Recap uses produce-recap persona
- State persists and loads across restarts
- Scheduled recap fires at configured cron time
- Scheduled recap does not double-fire within the same minute
- list_threads NotImplementedError → gracefully skipped
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from niuu.domain.mimir import ThreadState
from ravn.adapters.triggers.recap import RecapTrigger
from ravn.config import RecapConfig
from ravn.domain.models import AgentTask, OutputMode

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config(
    enabled: bool = True,
    absence_threshold_seconds: int = 3600,
    return_detection_window_seconds: int = 300,
    scheduled_recap_cron: str = "",
    max_threads_in_recap: int = 10,
    persona: str = "produce-recap",
    poll_interval_seconds: int = 60,
) -> RecapConfig:
    return RecapConfig(
        enabled=enabled,
        absence_threshold_seconds=absence_threshold_seconds,
        return_detection_window_seconds=return_detection_window_seconds,
        scheduled_recap_cron=scheduled_recap_cron,
        max_threads_in_recap=max_threads_in_recap,
        persona=persona,
        poll_interval_seconds=poll_interval_seconds,
    )


def _make_thread(
    path: str = "threads/example",
    title: str = "Example Thread",
    updated_at: datetime | None = None,
) -> MagicMock:
    """Create a minimal MimirPage mock representing a closed thread."""
    thread = MagicMock()
    thread.meta.path = path
    thread.meta.title = title
    thread.meta.updated_at = updated_at or datetime.now(UTC)
    thread.meta.thread_state = ThreadState.closed
    return thread


def _make_trigger(
    config: RecapConfig | None = None,
    last_interaction: MagicMock | None = None,
    mimir: AsyncMock | None = None,
    state_dir: Path | None = None,
    was_away: bool = True,
) -> RecapTrigger:
    trigger = RecapTrigger(
        mimir=mimir or AsyncMock(),
        config=config or _config(),
        last_interaction=last_interaction or MagicMock(return_value=None),
        state_dir=state_dir,
    )
    trigger._was_away = was_away
    return trigger


# ---------------------------------------------------------------------------
# Tests — Disabled
# ---------------------------------------------------------------------------


class TestDisabled:
    """RecapTrigger should exit immediately when disabled."""

    @pytest.mark.asyncio
    async def test_disabled_exits_immediately(self) -> None:
        trigger = _make_trigger(config=_config(enabled=False))
        enqueue = AsyncMock()

        await trigger.run(enqueue)

        enqueue.assert_not_awaited()


# ---------------------------------------------------------------------------
# Tests — Return Detection
# ---------------------------------------------------------------------------


class TestReturnDetection:
    """Operator return detection via interaction tracker."""

    @pytest.mark.asyncio
    async def test_no_interaction_no_recap(self) -> None:
        """No interaction recorded → tracker returns None → no recap."""
        last_interaction = MagicMock(return_value=None)
        mimir = AsyncMock()
        trigger = _make_trigger(last_interaction=last_interaction, mimir=mimir)

        enqueue = AsyncMock()
        await trigger._poll_once(enqueue)

        enqueue.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_return_after_long_absence_fires_recap(self) -> None:
        """Operator returns after >1h absence → recap fires with closed threads."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        # Last interaction was 30 seconds ago — operator just returned.
        last = now - timedelta(seconds=30)
        last_interaction = MagicMock(return_value=last)

        thread = _make_thread(updated_at=now - timedelta(hours=2))
        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=[thread])

        trigger = _make_trigger(
            config=_config(
                absence_threshold_seconds=3600,
                return_detection_window_seconds=300,
            ),
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=True,  # was away before this poll
        )
        # Set last_recap_at far in the past so the thread qualifies.
        trigger._last_recap_at = now - timedelta(hours=10)

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        enqueue.assert_awaited_once()
        task: AgentTask = enqueue.call_args[0][0]
        assert task.output_mode == OutputMode.SURFACE
        assert task.priority == 1
        assert task.persona == "produce-recap"

    @pytest.mark.asyncio
    async def test_short_break_no_recap(self) -> None:
        """Operator was active recently (short break) → was_away stays False → no recap."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        # Last interaction 30 seconds ago, but operator was NOT away.
        last = now - timedelta(seconds=30)
        last_interaction = MagicMock(return_value=last)

        mimir = AsyncMock()
        trigger = _make_trigger(
            config=_config(
                absence_threshold_seconds=3600,
                return_detection_window_seconds=300,
            ),
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=False,  # was NOT away — short break
        )

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        enqueue.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_sets_was_away_when_silence_exceeds_threshold(self) -> None:
        """Long silence → was_away becomes True."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        # Last interaction 2 hours ago.
        last = now - timedelta(hours=2)
        last_interaction = MagicMock(return_value=last)

        trigger = _make_trigger(
            config=_config(absence_threshold_seconds=3600),
            last_interaction=last_interaction,
            was_away=False,
        )
        enqueue = AsyncMock()

        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        assert trigger._was_away is True
        enqueue.assert_not_awaited()


# ---------------------------------------------------------------------------
# Tests — Content Gating
# ---------------------------------------------------------------------------


class TestContentGating:
    """Recap only fires when there is content to surface."""

    @pytest.mark.asyncio
    async def test_no_closed_threads_skips_recap(self) -> None:
        """No closed threads since last recap → recap skipped."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        last = now - timedelta(seconds=30)
        last_interaction = MagicMock(return_value=last)

        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=[])

        trigger = _make_trigger(
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=True,
        )
        trigger._last_recap_at = now - timedelta(hours=8)

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        enqueue.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_threads_older_than_last_recap_skipped(self) -> None:
        """Closed threads older than last_recap_at are filtered out → no recap."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        last_recap = now - timedelta(hours=2)
        # Thread was closed 3 hours ago — before last recap.
        thread = _make_thread(updated_at=now - timedelta(hours=3))

        last = now - timedelta(seconds=30)
        last_interaction = MagicMock(return_value=last)

        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=[thread])

        trigger = _make_trigger(
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=True,
        )
        trigger._last_recap_at = last_recap

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        enqueue.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_recap_includes_all_closed_threads_since_last_recap(self) -> None:
        """All closed threads newer than last_recap_at appear in the context."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        last_recap = now - timedelta(hours=8)

        threads = [
            _make_thread("threads/a", "Alpha", now - timedelta(hours=7)),
            _make_thread("threads/b", "Beta", now - timedelta(hours=6)),
            _make_thread("threads/c", "Gamma", now - timedelta(hours=5)),
        ]

        last = now - timedelta(seconds=30)
        last_interaction = MagicMock(return_value=last)

        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=threads)

        trigger = _make_trigger(
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=True,
        )
        trigger._last_recap_at = last_recap

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        enqueue.assert_awaited_once()
        task: AgentTask = enqueue.call_args[0][0]
        assert "threads/a" in task.initiative_context
        assert "threads/b" in task.initiative_context
        assert "threads/c" in task.initiative_context

    @pytest.mark.asyncio
    async def test_list_threads_not_implemented_gracefully_skips(self) -> None:
        """MimirPort.list_threads raises NotImplementedError → no crash, no recap."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        last = now - timedelta(seconds=30)
        last_interaction = MagicMock(return_value=last)

        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(side_effect=NotImplementedError)

        trigger = _make_trigger(
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=True,
        )

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        enqueue.assert_not_awaited()


# ---------------------------------------------------------------------------
# Tests — Task Properties
# ---------------------------------------------------------------------------


class TestTaskProperties:
    """Verify the enqueued AgentTask has the correct properties."""

    @pytest.mark.asyncio
    async def test_recap_priority_is_one(self) -> None:
        """Recap task always has priority=1 (runs before queued work)."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        last = now - timedelta(seconds=10)
        last_interaction = MagicMock(return_value=last)

        thread = _make_thread(updated_at=now - timedelta(hours=2))
        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=[thread])

        trigger = _make_trigger(last_interaction=last_interaction, mimir=mimir, was_away=True)
        trigger._last_recap_at = now - timedelta(hours=10)

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        task: AgentTask = enqueue.call_args[0][0]
        assert task.priority == 1

    @pytest.mark.asyncio
    async def test_recap_output_mode_is_surface(self) -> None:
        """Recap task uses OutputMode.SURFACE so it's shown directly to the operator."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        last = now - timedelta(seconds=10)
        last_interaction = MagicMock(return_value=last)

        thread = _make_thread(updated_at=now - timedelta(hours=2))
        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=[thread])

        trigger = _make_trigger(last_interaction=last_interaction, mimir=mimir, was_away=True)
        trigger._last_recap_at = now - timedelta(hours=10)

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        task: AgentTask = enqueue.call_args[0][0]
        assert task.output_mode == OutputMode.SURFACE

    @pytest.mark.asyncio
    async def test_recap_persona_comes_from_config(self) -> None:
        """Recap task persona is taken from RecapConfig.persona."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        last = now - timedelta(seconds=10)
        last_interaction = MagicMock(return_value=last)

        thread = _make_thread(updated_at=now - timedelta(hours=2))
        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=[thread])

        trigger = _make_trigger(
            config=_config(persona="custom-recap"),
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=True,
        )
        trigger._last_recap_at = now - timedelta(hours=10)

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        task: AgentTask = enqueue.call_args[0][0]
        assert task.persona == "custom-recap"


# ---------------------------------------------------------------------------
# Tests — State Persistence
# ---------------------------------------------------------------------------


class TestStatePersistence:
    """Recap state is persisted and restored across restarts."""

    def test_state_persists_last_recap_at_and_was_away(self, tmp_path: Path) -> None:
        """Save and load state round-trip preserves last_recap_at and was_away."""
        trigger = _make_trigger(state_dir=tmp_path)
        ts = datetime(2024, 6, 1, 8, 0, 0, tzinfo=UTC)
        trigger._last_recap_at = ts
        trigger._was_away = True
        trigger._save_state()

        trigger2 = _make_trigger(state_dir=tmp_path)
        trigger2._load_state()

        assert trigger2._last_recap_at == ts
        assert trigger2._was_away is True

    def test_state_restored_was_away_false(self, tmp_path: Path) -> None:
        """was_away=False is correctly round-tripped."""
        trigger = _make_trigger(state_dir=tmp_path)
        trigger._was_away = False
        trigger._save_state()

        trigger2 = _make_trigger(state_dir=tmp_path)
        trigger2._load_state()

        assert trigger2._was_away is False

    def test_missing_state_file_uses_defaults(self, tmp_path: Path) -> None:
        """Missing state file does not raise; defaults are preserved."""
        trigger = _make_trigger(state_dir=tmp_path)
        trigger._load_state()

        assert trigger._last_recap_at is None
        assert trigger._was_away is True

    def test_corrupt_state_file_does_not_raise(self, tmp_path: Path) -> None:
        """Corrupt state file is ignored without crashing."""
        state_file = tmp_path / "recap_state.json"
        state_file.write_text("NOT VALID JSON", encoding="utf-8")

        trigger = _make_trigger(state_dir=tmp_path)
        trigger._load_state()  # should not raise

        assert trigger._last_recap_at is None

    @pytest.mark.asyncio
    async def test_last_recap_at_updated_after_recap_fires(self, tmp_path: Path) -> None:
        """After recap fires, last_recap_at is updated and persisted."""
        now = datetime(2024, 6, 1, 9, 0, 0, tzinfo=UTC)
        last = now - timedelta(seconds=10)
        last_interaction = MagicMock(return_value=last)

        thread = _make_thread(updated_at=now - timedelta(hours=2))
        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=[thread])

        trigger = _make_trigger(
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=True,
            state_dir=tmp_path,
        )
        trigger._last_recap_at = now - timedelta(hours=10)

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        # State file should exist and contain last_recap_at.
        state_file = tmp_path / "recap_state.json"
        assert state_file.exists()
        saved = json.loads(state_file.read_text(encoding="utf-8"))
        assert "last_recap_at" in saved


# ---------------------------------------------------------------------------
# Tests — Scheduled Recap
# ---------------------------------------------------------------------------


class TestScheduledRecap:
    """Recap fires at configured cron time."""

    @pytest.mark.asyncio
    async def test_scheduled_recap_fires_at_cron_time(self) -> None:
        """scheduled_recap_cron='0 7 * * *' → fires at 07:00."""
        # 07:00 on a Monday (weekday=0 → cron weekday=1).
        now = datetime(2024, 6, 3, 7, 0, 0, tzinfo=UTC)

        # Operator is currently active but was NOT away (skips return path).
        last = now - timedelta(seconds=10)
        last_interaction = MagicMock(return_value=last)

        thread = _make_thread(updated_at=now - timedelta(hours=2))
        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=[thread])

        trigger = _make_trigger(
            config=_config(scheduled_recap_cron="0 7 * * *"),
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=False,  # no return-path firing
        )
        trigger._last_recap_at = now - timedelta(hours=10)

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        enqueue.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_scheduled_recap_does_not_double_fire_same_minute(self) -> None:
        """Two polls in the same minute → cron only fires once."""
        now = datetime(2024, 6, 3, 7, 0, 30, tzinfo=UTC)  # 30 sec past 07:00

        last = now - timedelta(seconds=10)
        last_interaction = MagicMock(return_value=last)

        thread = _make_thread(updated_at=now - timedelta(hours=2))
        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=[thread])

        trigger = _make_trigger(
            config=_config(scheduled_recap_cron="0 7 * * *"),
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=False,
        )
        trigger._last_recap_at = now - timedelta(hours=10)
        # Mark that this minute already fired.
        trigger._last_cron_minute = "2024-06-03T07:00"

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        enqueue.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_scheduled_recap_skipped_when_no_threads(self) -> None:
        """Scheduled cron fires but no closed threads → recap not enqueued."""
        now = datetime(2024, 6, 3, 7, 0, 0, tzinfo=UTC)

        last = now - timedelta(seconds=10)
        last_interaction = MagicMock(return_value=last)

        mimir = AsyncMock()
        mimir.list_threads = AsyncMock(return_value=[])

        trigger = _make_trigger(
            config=_config(scheduled_recap_cron="0 7 * * *"),
            last_interaction=last_interaction,
            mimir=mimir,
            was_away=False,
        )

        enqueue = AsyncMock()
        with patch("ravn.adapters.triggers.recap.datetime") as mock_dt:
            mock_dt.now.return_value = now
            mock_dt.fromisoformat = datetime.fromisoformat
            await trigger._poll_once(enqueue)

        enqueue.assert_not_awaited()


# ---------------------------------------------------------------------------
# Tests — Run loop
# ---------------------------------------------------------------------------


class TestRunLoop:
    """RecapTrigger.run() loop behaviour."""

    @pytest.mark.asyncio
    async def test_run_disabled_returns_immediately(self) -> None:
        trigger = _make_trigger(config=_config(enabled=False))
        enqueue = AsyncMock()
        await trigger.run(enqueue)
        enqueue.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_run_poll_error_does_not_crash(self, tmp_path: Path) -> None:
        """An exception in _poll_once is logged but does not crash the loop."""
        trigger = _make_trigger(config=_config(poll_interval_seconds=0), state_dir=tmp_path)

        call_count = 0

        async def _poll_once_raises(enqueue: object) -> None:
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise RuntimeError("boom")
            # Cancel after 3 calls to stop the loop.
            raise asyncio.CancelledError

        trigger._poll_once = _poll_once_raises  # type: ignore[method-assign]

        with pytest.raises(asyncio.CancelledError):
            await trigger.run(AsyncMock())

        assert call_count == 3
