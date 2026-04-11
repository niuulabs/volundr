"""Unit tests for niuu.domain.mimir thread fields (NIU-564).

Covers:
- MimirPageMeta with thread fields constructs correctly
- MimirPageMeta without thread fields: all thread fields are None / defaults
- ThreadState enum values match expected strings
- ThreadContextRef constructs and serialises correctly
"""

from __future__ import annotations

from datetime import UTC, datetime

from niuu.domain.mimir import (
    MimirPageMeta,
    ThreadContextRef,
    ThreadState,
)

# ---------------------------------------------------------------------------
# ThreadState
# ---------------------------------------------------------------------------


class TestThreadState:
    def test_open_value(self) -> None:
        assert ThreadState.open == "open"

    def test_assigned_value(self) -> None:
        assert ThreadState.assigned == "assigned"

    def test_pulling_value(self) -> None:
        assert ThreadState.pulling == "pulling"

    def test_closed_value(self) -> None:
        assert ThreadState.closed == "closed"

    def test_dissolved_value(self) -> None:
        assert ThreadState.dissolved == "dissolved"

    def test_all_five_states_exist(self) -> None:
        values = {s.value for s in ThreadState}
        assert values == {"open", "assigned", "pulling", "closed", "dissolved"}

    def test_is_str_enum(self) -> None:
        # StrEnum members compare equal to their string values
        assert ThreadState.open == "open"
        assert str(ThreadState.open) == "open"

    def test_round_trip_from_string(self) -> None:
        for state in ThreadState:
            assert ThreadState(state.value) is state


# ---------------------------------------------------------------------------
# ThreadContextRef
# ---------------------------------------------------------------------------


class TestThreadContextRef:
    def test_constructs_with_all_fields(self) -> None:
        ref = ThreadContextRef(type="conversation", id="sess-abc", summary="User asked about auth")
        assert ref.type == "conversation"
        assert ref.id == "sess-abc"
        assert ref.summary == "User asked about auth"

    def test_constructs_wiki_page_type(self) -> None:
        ref = ThreadContextRef(type="wiki_page", id="src-001", summary="")
        assert ref.type == "wiki_page"
        assert ref.id == "src-001"
        assert ref.summary == ""

    def test_constructs_issue_type(self) -> None:
        ref = ThreadContextRef(type="issue", id="NIU-100", summary="Linked Linear issue")
        assert ref.type == "issue"
        assert ref.id == "NIU-100"

    def test_fields_are_plain_strings(self) -> None:
        ref = ThreadContextRef(type="t", id="i", summary="s")
        assert isinstance(ref.type, str)
        assert isinstance(ref.id, str)
        assert isinstance(ref.summary, str)


# ---------------------------------------------------------------------------
# MimirPageMeta — thread fields present
# ---------------------------------------------------------------------------


class TestMimirPageMetaWithThreadFields:
    def _make_meta(self, **overrides) -> MimirPageMeta:
        defaults = dict(
            path="technical/auth.md",
            title="Auth Deep-Dive",
            summary="Open question about session tokens",
            category="technical",
            updated_at=datetime(2024, 6, 1, tzinfo=UTC),
            source_ids=["src-1"],
            thread_state=ThreadState.open,
            thread_weight=1.2,
            is_thread=True,
            thread_weight_signals={"age_days": 0.0, "mention_count": 2},
            thread_next_action_hint="Review token storage approach",
            thread_context_refs=[ThreadContextRef(type="wiki_page", id="src-1", summary="")],
            produced_by_thread=False,
        )
        defaults.update(overrides)
        return MimirPageMeta(**defaults)

    def test_thread_state_set(self) -> None:
        meta = self._make_meta()
        assert meta.thread_state == ThreadState.open

    def test_thread_weight_set(self) -> None:
        meta = self._make_meta()
        assert meta.thread_weight == 1.2

    def test_is_thread_true(self) -> None:
        meta = self._make_meta()
        assert meta.is_thread is True

    def test_thread_weight_signals_preserved(self) -> None:
        meta = self._make_meta()
        assert meta.thread_weight_signals["age_days"] == 0.0
        assert meta.thread_weight_signals["mention_count"] == 2

    def test_thread_next_action_hint_set(self) -> None:
        meta = self._make_meta()
        assert meta.thread_next_action_hint == "Review token storage approach"

    def test_thread_context_refs_set(self) -> None:
        meta = self._make_meta()
        assert len(meta.thread_context_refs) == 1
        assert meta.thread_context_refs[0].type == "wiki_page"
        assert meta.thread_context_refs[0].id == "src-1"

    def test_produced_by_thread_false(self) -> None:
        meta = self._make_meta()
        assert meta.produced_by_thread is False

    def test_produced_by_thread_can_be_true(self) -> None:
        meta = self._make_meta(produced_by_thread=True)
        assert meta.produced_by_thread is True

    def test_non_thread_fields_unchanged(self) -> None:
        meta = self._make_meta()
        assert meta.path == "technical/auth.md"
        assert meta.title == "Auth Deep-Dive"
        assert meta.category == "technical"
        assert meta.source_ids == ["src-1"]

    def test_assigned_thread_state(self) -> None:
        meta = self._make_meta(thread_state=ThreadState.assigned)
        assert meta.thread_state == ThreadState.assigned

    def test_pulling_thread_state(self) -> None:
        meta = self._make_meta(thread_state=ThreadState.pulling)
        assert meta.thread_state == ThreadState.pulling

    def test_multiple_context_refs(self) -> None:
        refs = [
            ThreadContextRef(type="wiki_page", id="src-1", summary=""),
            ThreadContextRef(type="conversation", id="sess-99", summary="live discussion"),
        ]
        meta = self._make_meta(thread_context_refs=refs)
        assert len(meta.thread_context_refs) == 2
        assert meta.thread_context_refs[1].id == "sess-99"


# ---------------------------------------------------------------------------
# MimirPageMeta — no thread fields (plain wiki page)
# ---------------------------------------------------------------------------


class TestMimirPageMetaWithoutThreadFields:
    def _make_plain_meta(self) -> MimirPageMeta:
        return MimirPageMeta(
            path="projects/overview.md",
            title="Project Overview",
            summary="High-level summary of active projects",
            category="projects",
            updated_at=datetime(2024, 5, 10, tzinfo=UTC),
        )

    def test_thread_state_is_none(self) -> None:
        assert self._make_plain_meta().thread_state is None

    def test_thread_weight_is_none(self) -> None:
        assert self._make_plain_meta().thread_weight is None

    def test_is_thread_is_false(self) -> None:
        assert self._make_plain_meta().is_thread is False

    def test_thread_weight_signals_is_empty_dict(self) -> None:
        assert self._make_plain_meta().thread_weight_signals == {}

    def test_thread_next_action_hint_is_none(self) -> None:
        assert self._make_plain_meta().thread_next_action_hint is None

    def test_thread_context_refs_is_empty_list(self) -> None:
        assert self._make_plain_meta().thread_context_refs == []

    def test_produced_by_thread_is_false(self) -> None:
        assert self._make_plain_meta().produced_by_thread is False

    def test_source_ids_defaults_to_empty_list(self) -> None:
        assert self._make_plain_meta().source_ids == []
