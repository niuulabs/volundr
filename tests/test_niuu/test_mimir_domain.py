"""Tests for niuu.domain.mimir — thread-related domain models.

Covers:
- ThreadState enum
- ThreadContextRef dataclass
- MimirPageMeta thread field defaults and population
- ThreadSchemaError
- ThreadYamlSchema: from_dict / to_dict roundtrip, from_yaml / to_yaml
  (atomic write), validation rules, to_page_meta
"""

from __future__ import annotations

import textwrap
from datetime import UTC, datetime
from pathlib import Path

import pytest

from niuu.domain.mimir import (
    MimirPageMeta,
    ThreadContextRef,
    ThreadSchemaError,
    ThreadState,
    ThreadYamlSchema,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 4, 10, 12, 0, 0, tzinfo=UTC)
_LATER = datetime(2026, 4, 10, 13, 0, 0, tzinfo=UTC)


def _minimal_dict() -> dict:
    """Return the smallest valid thread dict."""
    return {
        "title": "My Thread",
        "state": "open",
        "weight": 1.5,
        "created_at": _NOW.isoformat(),
        "updated_at": _LATER.isoformat(),
    }


def _full_dict() -> dict:
    """Return a fully-populated thread dict."""
    return {
        "title": "My Thread",
        "state": "pulling",
        "weight": 2.0,
        "created_at": _NOW.isoformat(),
        "updated_at": _LATER.isoformat(),
        "owner_id": "user_42",
        "next_action_hint": "Review PR",
        "resolved_artifact_path": "artifacts/pr.md",
        "context_refs": [
            {
                "ref_type": "conversation",
                "ref_id": "conv_1",
                "ref_summary": "Initial discussion",
            }
        ],
        "weight_signals": {"urgency": 0.8},
    }


# ---------------------------------------------------------------------------
# ThreadState
# ---------------------------------------------------------------------------


class TestThreadState:
    def test_all_members_exist(self):
        values = {s.value for s in ThreadState}
        assert values == {
            "open",
            "pulling",
            "blocked",
            "waiting_for_peer",
            "waiting_for_operator",
            "closed",
            "dissolved",
        }

    def test_is_str_subclass(self):
        assert isinstance(ThreadState.open, str)

    def test_round_trip(self):
        for state in ThreadState:
            assert ThreadState(state.value) is state

    def test_invalid_raises_value_error(self):
        with pytest.raises(ValueError):
            ThreadState("nonexistent")


# ---------------------------------------------------------------------------
# ThreadContextRef
# ---------------------------------------------------------------------------


class TestThreadContextRef:
    def test_construction(self):
        ref = ThreadContextRef(
            ref_type="conversation",
            ref_id="conv_1",
            ref_summary="A conversation",
        )
        assert ref.ref_type == "conversation"
        assert ref.ref_id == "conv_1"
        assert ref.ref_summary == "A conversation"

    def test_all_ref_types_accepted(self):
        for rt in ("conversation", "ingest", "observation", "search"):
            ref = ThreadContextRef(ref_type=rt, ref_id="x", ref_summary="y")  # type: ignore[arg-type]
            assert ref.ref_type == rt


# ---------------------------------------------------------------------------
# MimirPageMeta — thread field defaults
# ---------------------------------------------------------------------------


class TestMimirPageMetaThreadDefaults:
    def test_defaults_are_none_or_empty(self):
        meta = MimirPageMeta(
            path="foo/bar.md",
            title="Foo",
            summary="A page",
            category="technical",
            updated_at=_NOW,
        )
        assert meta.thread_state is None
        assert meta.thread_weight is None
        assert meta.thread_owner_id is None
        assert meta.thread_context_refs == []
        assert meta.thread_next_action_hint is None
        assert meta.thread_resolved_artifact_path is None
        assert meta.thread_weight_signals is None

    def test_thread_fields_set_independently(self):
        meta = MimirPageMeta(
            path="threads/t.yaml",
            title="T",
            summary="",
            category="threads",
            updated_at=_NOW,
            thread_state=ThreadState.open,
            thread_weight=1.0,
        )
        assert meta.thread_state is ThreadState.open
        assert meta.thread_weight == 1.0


# ---------------------------------------------------------------------------
# ThreadSchemaError
# ---------------------------------------------------------------------------


class TestThreadSchemaError:
    def test_attributes(self):
        err = ThreadSchemaError("/path/to/file.yaml", "bad state")
        assert err.path == "/path/to/file.yaml"
        assert err.reason == "bad state"

    def test_message_format(self):
        err = ThreadSchemaError("/p.yaml", "missing title")
        assert "/p.yaml" in str(err)
        assert "missing title" in str(err)

    def test_is_exception(self):
        assert isinstance(ThreadSchemaError("x", "y"), Exception)


# ---------------------------------------------------------------------------
# ThreadYamlSchema.from_dict — happy path
# ---------------------------------------------------------------------------


class TestFromDictHappyPath:
    def test_minimal_fields(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        assert schema.title == "My Thread"
        assert schema.state is ThreadState.open
        assert schema.weight == 1.5
        assert schema.created_at == _NOW
        assert schema.updated_at == _LATER
        assert schema.owner_id is None
        assert schema.next_action_hint is None
        assert schema.resolved_artifact_path is None
        assert schema.context_refs == []
        assert schema.weight_signals == {}

    def test_full_fields(self):
        schema = ThreadYamlSchema.from_dict(_full_dict())
        assert schema.title == "My Thread"
        assert schema.state is ThreadState.pulling
        assert schema.weight == 2.0
        assert schema.owner_id == "user_42"
        assert schema.next_action_hint == "Review PR"
        assert schema.resolved_artifact_path == "artifacts/pr.md"
        assert len(schema.context_refs) == 1
        assert schema.context_refs[0].ref_type == "conversation"
        assert schema.context_refs[0].ref_id == "conv_1"
        assert schema.weight_signals == {"urgency": 0.8}

    def test_unknown_keys_ignored(self):
        data = {**_minimal_dict(), "future_field": "ignored"}
        schema = ThreadYamlSchema.from_dict(data)
        assert schema.title == "My Thread"

    def test_datetime_object_accepted_for_created_at(self):
        data = {**_minimal_dict(), "created_at": _NOW, "updated_at": _LATER}
        schema = ThreadYamlSchema.from_dict(data)
        assert schema.created_at == _NOW

    def test_weight_as_integer(self):
        data = {**_minimal_dict(), "weight": 3}
        schema = ThreadYamlSchema.from_dict(data)
        assert schema.weight == 3.0

    def test_all_thread_states(self):
        for state in ThreadState:
            data = {**_minimal_dict(), "state": state.value}
            schema = ThreadYamlSchema.from_dict(data)
            assert schema.state is state


# ---------------------------------------------------------------------------
# ThreadYamlSchema.from_dict — validation errors
# ---------------------------------------------------------------------------


class TestFromDictValidation:
    def test_missing_title(self):
        data = _minimal_dict()
        del data["title"]
        with pytest.raises(ThreadSchemaError, match="title"):
            ThreadYamlSchema.from_dict(data)

    def test_empty_title(self):
        data = {**_minimal_dict(), "title": "   "}
        with pytest.raises(ThreadSchemaError, match="title"):
            ThreadYamlSchema.from_dict(data)

    def test_missing_state(self):
        data = _minimal_dict()
        del data["state"]
        with pytest.raises(ThreadSchemaError, match="state"):
            ThreadYamlSchema.from_dict(data)

    def test_invalid_state(self):
        data = {**_minimal_dict(), "state": "flying"}
        with pytest.raises(ThreadSchemaError, match="state"):
            ThreadYamlSchema.from_dict(data)

    def test_missing_weight(self):
        data = _minimal_dict()
        del data["weight"]
        with pytest.raises(ThreadSchemaError, match="weight"):
            ThreadYamlSchema.from_dict(data)

    def test_negative_weight(self):
        data = {**_minimal_dict(), "weight": -0.1}
        with pytest.raises(ThreadSchemaError, match="weight"):
            ThreadYamlSchema.from_dict(data)

    def test_non_numeric_weight(self):
        data = {**_minimal_dict(), "weight": "heavy"}
        with pytest.raises(ThreadSchemaError, match="weight"):
            ThreadYamlSchema.from_dict(data)

    def test_missing_created_at(self):
        data = _minimal_dict()
        del data["created_at"]
        with pytest.raises(ThreadSchemaError, match="created_at"):
            ThreadYamlSchema.from_dict(data)

    def test_invalid_created_at(self):
        data = {**_minimal_dict(), "created_at": "not-a-date"}
        with pytest.raises(ThreadSchemaError, match="created_at"):
            ThreadYamlSchema.from_dict(data)

    def test_missing_updated_at(self):
        data = _minimal_dict()
        del data["updated_at"]
        with pytest.raises(ThreadSchemaError, match="updated_at"):
            ThreadYamlSchema.from_dict(data)

    def test_invalid_updated_at(self):
        data = {**_minimal_dict(), "updated_at": 12345}
        with pytest.raises(ThreadSchemaError, match="updated_at"):
            ThreadYamlSchema.from_dict(data)

    def test_context_refs_not_list(self):
        data = {**_minimal_dict(), "context_refs": "oops"}
        with pytest.raises(ThreadSchemaError, match="context_refs"):
            ThreadYamlSchema.from_dict(data)

    def test_context_ref_not_dict(self):
        data = {**_minimal_dict(), "context_refs": ["bad"]}
        with pytest.raises(ThreadSchemaError, match="context_refs"):
            ThreadYamlSchema.from_dict(data)

    def test_context_ref_missing_key(self):
        data = {
            **_minimal_dict(),
            "context_refs": [{"ref_type": "search", "ref_id": "x"}],  # missing ref_summary
        }
        with pytest.raises(ThreadSchemaError, match="ref_summary"):
            ThreadYamlSchema.from_dict(data)

    def test_weight_signals_not_dict(self):
        data = {**_minimal_dict(), "weight_signals": ["bad"]}
        with pytest.raises(ThreadSchemaError, match="weight_signals"):
            ThreadYamlSchema.from_dict(data)

    def test_context_ref_invalid_ref_type(self):
        data = {
            **_minimal_dict(),
            "context_refs": [{"ref_type": "foobar", "ref_id": "x", "ref_summary": "y"}],
        }
        with pytest.raises(ThreadSchemaError, match="ref_type"):
            ThreadYamlSchema.from_dict(data)


# ---------------------------------------------------------------------------
# ThreadYamlSchema.to_dict / roundtrip
# ---------------------------------------------------------------------------


class TestToDictRoundtrip:
    def test_minimal_roundtrip(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        restored = ThreadYamlSchema.from_dict(schema.to_dict())
        assert restored.title == schema.title
        assert restored.state == schema.state
        assert restored.weight == schema.weight
        assert restored.created_at == schema.created_at
        assert restored.updated_at == schema.updated_at

    def test_full_roundtrip(self):
        schema = ThreadYamlSchema.from_dict(_full_dict())
        d = schema.to_dict()
        restored = ThreadYamlSchema.from_dict(d)
        assert restored.owner_id == schema.owner_id
        assert restored.next_action_hint == schema.next_action_hint
        assert restored.resolved_artifact_path == schema.resolved_artifact_path
        assert len(restored.context_refs) == len(schema.context_refs)
        assert restored.context_refs[0].ref_id == schema.context_refs[0].ref_id
        assert restored.weight_signals == schema.weight_signals

    def test_to_dict_state_is_string(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        d = schema.to_dict()
        assert isinstance(d["state"], str)
        assert d["state"] == "open"

    def test_to_dict_datetimes_are_iso_strings(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        d = schema.to_dict()
        assert isinstance(d["created_at"], str)
        assert isinstance(d["updated_at"], str)
        # Should be parseable
        datetime.fromisoformat(d["created_at"])
        datetime.fromisoformat(d["updated_at"])


# ---------------------------------------------------------------------------
# ThreadYamlSchema.from_yaml / to_yaml
# ---------------------------------------------------------------------------


class TestYamlFileIO:
    def test_round_trip_via_files(self, tmp_path: Path):
        schema = ThreadYamlSchema.from_dict(_full_dict())
        out = tmp_path / "thread.yaml"
        schema.to_yaml(out)
        restored = ThreadYamlSchema.from_yaml(out)
        assert restored.title == schema.title
        assert restored.state == schema.state
        assert restored.weight == schema.weight
        assert len(restored.context_refs) == 1

    def test_atomic_write_no_tmp_file_left(self, tmp_path: Path):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        out = tmp_path / "thread.yaml"
        schema.to_yaml(out)
        tmp_file = tmp_path / "thread.yaml.tmp"
        assert out.exists()
        assert not tmp_file.exists()

    def test_from_yaml_missing_file(self, tmp_path: Path):
        with pytest.raises(ThreadSchemaError, match="cannot read"):
            ThreadYamlSchema.from_yaml(tmp_path / "nonexistent.yaml")

    def test_from_yaml_invalid_yaml(self, tmp_path: Path):
        bad = tmp_path / "bad.yaml"
        bad.write_text(": : : invalid\n", encoding="utf-8")
        with pytest.raises(ThreadSchemaError):
            ThreadYamlSchema.from_yaml(bad)

    def test_from_yaml_non_mapping_top_level(self, tmp_path: Path):
        bad = tmp_path / "bad.yaml"
        bad.write_text("- list item\n", encoding="utf-8")
        with pytest.raises(ThreadSchemaError, match="mapping"):
            ThreadYamlSchema.from_yaml(bad)

    def test_from_yaml_validation_error(self, tmp_path: Path):
        yaml_text = textwrap.dedent(
            """\
            title: My Thread
            state: bogus
            weight: 1.0
            created_at: "2026-04-10T12:00:00+00:00"
            updated_at: "2026-04-10T13:00:00+00:00"
            """
        )
        bad = tmp_path / "bad.yaml"
        bad.write_text(yaml_text, encoding="utf-8")
        with pytest.raises(ThreadSchemaError, match="state"):
            ThreadYamlSchema.from_yaml(bad)

    def test_from_yaml_minimal_valid(self, tmp_path: Path):
        yaml_text = textwrap.dedent(
            """\
            title: Hello
            state: closed
            weight: 0.0
            created_at: "2026-01-01T00:00:00+00:00"
            updated_at: "2026-01-01T00:00:00+00:00"
            """
        )
        p = tmp_path / "t.yaml"
        p.write_text(yaml_text, encoding="utf-8")
        schema = ThreadYamlSchema.from_yaml(p)
        assert schema.state is ThreadState.closed
        assert schema.weight == 0.0


# ---------------------------------------------------------------------------
# ThreadYamlSchema.to_page_meta
# ---------------------------------------------------------------------------


class TestToPageMeta:
    def test_produces_mimir_page_meta(self):
        schema = ThreadYamlSchema.from_dict(_full_dict())
        meta = schema.to_page_meta("my-thread")
        assert isinstance(meta, MimirPageMeta)

    def test_path_uses_slug(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        meta = schema.to_page_meta("the-slug")
        assert meta.path == "threads/the-slug.yaml"

    def test_category_is_threads(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        meta = schema.to_page_meta("s")
        assert meta.category == "threads"

    def test_thread_state_populated(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        meta = schema.to_page_meta("s")
        assert meta.thread_state is ThreadState.open

    def test_thread_weight_populated(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        meta = schema.to_page_meta("s")
        assert meta.thread_weight == 1.5

    def test_thread_owner_populated(self):
        schema = ThreadYamlSchema.from_dict(_full_dict())
        meta = schema.to_page_meta("s")
        assert meta.thread_owner_id == "user_42"

    def test_thread_context_refs_populated(self):
        schema = ThreadYamlSchema.from_dict(_full_dict())
        meta = schema.to_page_meta("s")
        assert len(meta.thread_context_refs) == 1
        assert meta.thread_context_refs[0].ref_id == "conv_1"

    def test_thread_next_action_hint_populated(self):
        schema = ThreadYamlSchema.from_dict(_full_dict())
        meta = schema.to_page_meta("s")
        assert meta.thread_next_action_hint == "Review PR"

    def test_thread_resolved_artifact_path_populated(self):
        schema = ThreadYamlSchema.from_dict(_full_dict())
        meta = schema.to_page_meta("s")
        assert meta.thread_resolved_artifact_path == "artifacts/pr.md"

    def test_thread_weight_signals_populated(self):
        schema = ThreadYamlSchema.from_dict(_full_dict())
        meta = schema.to_page_meta("s")
        assert meta.thread_weight_signals == {"urgency": 0.8}

    def test_updated_at_propagated(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        meta = schema.to_page_meta("s")
        assert meta.updated_at == _LATER

    def test_title_propagated(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        meta = schema.to_page_meta("s")
        assert meta.title == "My Thread"

    def test_weight_signals_none_when_empty(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        meta = schema.to_page_meta("s")
        # empty weight_signals dict → None in page meta
        assert meta.thread_weight_signals is None

    def test_summary_is_next_action_hint(self):
        schema = ThreadYamlSchema.from_dict(_full_dict())
        meta = schema.to_page_meta("s")
        assert meta.summary == "Review PR"

    def test_summary_empty_when_no_hint(self):
        schema = ThreadYamlSchema.from_dict(_minimal_dict())
        meta = schema.to_page_meta("s")
        assert meta.summary == ""
