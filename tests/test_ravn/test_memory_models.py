"""Tests for episodic memory domain models."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from ravn.domain.models import (
    Episode,
    EpisodeMatch,
    Outcome,
    SessionSummary,
    SharedContext,
)


class TestOutcome:
    def test_values(self) -> None:
        assert Outcome.SUCCESS == "success"
        assert Outcome.FAILURE == "failure"
        assert Outcome.PARTIAL == "partial"

    def test_from_string(self) -> None:
        assert Outcome("success") is Outcome.SUCCESS
        assert Outcome("failure") is Outcome.FAILURE
        assert Outcome("partial") is Outcome.PARTIAL

    def test_invalid_raises(self) -> None:
        with pytest.raises(ValueError):
            Outcome("unknown")


class TestEpisode:
    def _make(self, **kwargs) -> Episode:
        defaults = dict(
            episode_id="ep-1",
            session_id="sess-1",
            timestamp=datetime.now(UTC),
            summary="Did something useful",
            task_description="Do something useful",
            tools_used=["file_read"],
            outcome=Outcome.SUCCESS,
            tags=["file_operations"],
            embedding=None,
        )
        defaults.update(kwargs)
        return Episode(**defaults)

    def test_default_no_embedding(self) -> None:
        ep = self._make()
        assert ep.embedding is None

    def test_with_embedding(self) -> None:
        ep = self._make(embedding=[0.1, 0.2, 0.3])
        assert ep.embedding == [0.1, 0.2, 0.3]

    def test_tools_used_list(self) -> None:
        ep = self._make(tools_used=["bash", "git_commit"])
        assert "bash" in ep.tools_used
        assert "git_commit" in ep.tools_used

    def test_tags_list(self) -> None:
        ep = self._make(tags=["shell", "git"])
        assert ep.tags == ["shell", "git"]

    def test_outcome_stored(self) -> None:
        ep = self._make(outcome=Outcome.FAILURE)
        assert ep.outcome == Outcome.FAILURE


class TestEpisodeMatch:
    def test_frozen(self) -> None:
        ep = Episode(
            episode_id="x",
            session_id="s",
            timestamp=datetime.now(UTC),
            summary="s",
            task_description="t",
            tools_used=[],
            outcome=Outcome.SUCCESS,
            tags=[],
        )
        match = EpisodeMatch(episode=ep, relevance=0.85)
        assert match.relevance == pytest.approx(0.85)
        # frozen — can't reassign
        with pytest.raises(Exception):
            match.relevance = 0.5  # type: ignore[misc]

    def test_relevance_range(self) -> None:
        ep = Episode(
            episode_id="x",
            session_id="s",
            timestamp=datetime.now(UTC),
            summary="s",
            task_description="t",
            tools_used=[],
            outcome=Outcome.SUCCESS,
            tags=[],
        )
        match = EpisodeMatch(episode=ep, relevance=0.0)
        assert match.relevance == 0.0


class TestSessionSummary:
    def test_frozen(self) -> None:
        s = SessionSummary(
            session_id="sess",
            summary="did stuff",
            episode_count=3,
            last_active=datetime.now(UTC),
            tags=["git"],
        )
        with pytest.raises(Exception):
            s.episode_count = 5  # type: ignore[misc]

    def test_fields(self) -> None:
        ts = datetime(2024, 1, 1, tzinfo=UTC)
        s = SessionSummary(
            session_id="abc",
            summary="summary text",
            episode_count=2,
            last_active=ts,
            tags=["web"],
        )
        assert s.session_id == "abc"
        assert s.episode_count == 2
        assert s.last_active == ts


class TestSharedContext:
    def test_default_empty_data(self) -> None:
        ctx = SharedContext()
        assert ctx.data == {}

    def test_custom_data(self) -> None:
        ctx = SharedContext(data={"key": "value", "count": 42})
        assert ctx.data["key"] == "value"
        assert ctx.data["count"] == 42

    def test_mutable(self) -> None:
        ctx = SharedContext()
        ctx.data["x"] = 1
        assert ctx.data["x"] == 1
