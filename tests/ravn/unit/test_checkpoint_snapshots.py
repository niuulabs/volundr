"""Tests for NIU-537 checkpoint snapshot features.

Covers:
- Extended Checkpoint domain model (checkpoint_id, label, tags, seq, memory_context)
- Extended CheckpointPort (save_snapshot, list_for_task, load_snapshot, delete_snapshot)
- DiskCheckpointAdapter gzip+0600 storage, sequential IDs, pruning
- Agent auto-snapshot triggers (N-tools, budget milestones, before destructive ops)
- Resume flow with named snapshot
"""

from __future__ import annotations

import gzip
import json
import stat
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest

from ravn.adapters.checkpoint.disk import DiskCheckpointAdapter, _from_dict, _to_dict
from ravn.adapters.permission.allow_deny import AllowAllPermission
from ravn.agent import RavnAgent
from ravn.domain.checkpoint import Checkpoint
from ravn.domain.models import (
    LLMResponse,
    Session,
    StopReason,
    TokenUsage,
    ToolCall,
)
from ravn.ports.checkpoint import CheckpointPort
from tests.ravn.conftest import InMemoryChannel, MockLLM, make_text_response
from tests.ravn.fixtures.fakes import EchoTool

# ---------------------------------------------------------------------------
# In-memory checkpoint adapter supporting full NIU-537 API
# ---------------------------------------------------------------------------


class InMemoryCheckpointAdapter(CheckpointPort):
    """In-memory adapter for tests — supports both crash-recovery and snapshots."""

    def __init__(self, max_snapshots: int = 20) -> None:
        self._crash: dict[str, Checkpoint] = {}
        self._snapshots: dict[str, Checkpoint] = {}
        self._task_seqs: dict[str, int] = {}
        self._max_snapshots = max_snapshots

    # Crash-recovery
    async def save(self, checkpoint: Checkpoint) -> None:
        self._crash[checkpoint.task_id] = checkpoint

    async def load(self, task_id: str) -> Checkpoint | None:
        return self._crash.get(task_id)

    async def delete(self, task_id: str) -> None:
        self._crash.pop(task_id, None)

    async def list_task_ids(self) -> list[str]:
        return list(self._crash.keys())

    # Named snapshots
    async def save_snapshot(self, checkpoint: Checkpoint) -> str:
        seq = self._task_seqs.get(checkpoint.task_id, 0) + 1
        self._task_seqs[checkpoint.task_id] = seq
        checkpoint_id = Checkpoint.make_snapshot_id(checkpoint.task_id, seq)
        checkpoint.checkpoint_id = checkpoint_id
        checkpoint.seq = seq
        self._snapshots[checkpoint_id] = checkpoint

        # Prune
        task_snaps = sorted(
            [s for s in self._snapshots.values() if s.task_id == checkpoint.task_id],
            key=lambda s: s.seq,
            reverse=True,
        )
        if len(task_snaps) > self._max_snapshots:
            for old in task_snaps[self._max_snapshots :]:
                del self._snapshots[old.checkpoint_id]

        return checkpoint_id

    async def list_for_task(self, task_id: str) -> list[Checkpoint]:
        return sorted(
            [s for s in self._snapshots.values() if s.task_id == task_id],
            key=lambda s: s.seq,
            reverse=True,
        )

    async def load_snapshot(self, checkpoint_id: str) -> Checkpoint | None:
        return self._snapshots.get(checkpoint_id)

    async def delete_snapshot(self, checkpoint_id: str) -> None:
        self._snapshots.pop(checkpoint_id, None)


def _make_checkpoint(task_id: str = "task_001") -> Checkpoint:
    return Checkpoint(
        task_id=task_id,
        user_input="do something",
        messages=[{"role": "user", "content": "do something"}],
        todos=[],
        iteration_budget_consumed=3,
        iteration_budget_total=90,
        last_tool_call=None,
        last_tool_result=None,
        partial_response="",
        interrupted_by=None,
        created_at=datetime(2026, 4, 8, 12, 0, 0, tzinfo=UTC),
    )


def _make_tool_response(tool_id: str = "tc1") -> LLMResponse:
    return LLMResponse(
        content="",
        tool_calls=[ToolCall(id=tool_id, name="echo", input={"message": "hi"})],
        stop_reason=StopReason.TOOL_USE,
        usage=TokenUsage(input_tokens=10, output_tokens=5),
    )


# ---------------------------------------------------------------------------
# Domain model extension tests
# ---------------------------------------------------------------------------


class TestCheckpointModelExtensions:
    def test_new_fields_have_sensible_defaults(self) -> None:
        cp = _make_checkpoint()
        assert cp.checkpoint_id == ""
        assert cp.seq == 0
        assert cp.label == ""
        assert cp.tags == []
        assert cp.memory_context == ""

    def test_is_named_snapshot_false_for_crash_recovery(self) -> None:
        cp = _make_checkpoint()
        assert cp.is_named_snapshot is False

    def test_is_named_snapshot_true_when_checkpoint_id_set(self) -> None:
        cp = _make_checkpoint()
        cp.checkpoint_id = "ckpt_task_001_1"
        assert cp.is_named_snapshot is True

    def test_make_snapshot_id_format(self) -> None:
        cid = Checkpoint.make_snapshot_id("my_task", 3)
        assert cid == "ckpt_my_task_3"

    def test_to_dict_includes_snapshot_fields(self) -> None:
        cp = _make_checkpoint()
        cp.label = "after tests"
        cp.tags = ["green", "stable"]
        cp.seq = 2
        cp.checkpoint_id = "ckpt_task_001_2"
        cp.memory_context = "some context"
        d = _to_dict(cp)
        assert d["label"] == "after tests"
        assert d["tags"] == ["green", "stable"]
        assert d["seq"] == 2
        assert d["checkpoint_id"] == "ckpt_task_001_2"
        assert d["memory_context"] == "some context"

    def test_from_dict_restores_snapshot_fields(self) -> None:
        cp = _make_checkpoint()
        cp.label = "milestone"
        cp.tags = ["t1"]
        cp.seq = 5
        cp.checkpoint_id = "ckpt_task_001_5"
        cp.memory_context = "ctx"
        d = _to_dict(cp)
        restored = _from_dict(d)
        assert restored.label == "milestone"
        assert restored.tags == ["t1"]
        assert restored.seq == 5
        assert restored.checkpoint_id == "ckpt_task_001_5"
        assert restored.memory_context == "ctx"

    def test_from_dict_missing_snapshot_fields_defaults(self) -> None:
        d = {
            "task_id": "x",
            "user_input": "",
            "messages": [],
            "todos": [],
            "iteration_budget_consumed": 0,
            "iteration_budget_total": 0,
            "last_tool_call": None,
            "last_tool_result": None,
            "partial_response": "",
            "interrupted_by": None,
            "created_at": datetime.now(UTC).isoformat(),
        }
        cp = _from_dict(d)
        assert cp.checkpoint_id == ""
        assert cp.seq == 0
        assert cp.label == ""
        assert cp.tags == []
        assert cp.memory_context == ""


# ---------------------------------------------------------------------------
# CheckpointPort — snapshot methods
# ---------------------------------------------------------------------------


class TestCheckpointPortSnapshotMethods:
    @pytest.mark.asyncio
    async def test_save_snapshot_assigns_sequential_ids(self) -> None:
        store = InMemoryCheckpointAdapter()
        cp = _make_checkpoint()
        cid1 = await store.save_snapshot(cp)
        cid2 = await store.save_snapshot(_make_checkpoint())
        assert cid1 == "ckpt_task_001_1"
        assert cid2 == "ckpt_task_001_2"

    @pytest.mark.asyncio
    async def test_save_snapshot_sets_seq_on_checkpoint(self) -> None:
        store = InMemoryCheckpointAdapter()
        cp = _make_checkpoint()
        await store.save_snapshot(cp)
        assert cp.seq == 1
        assert cp.checkpoint_id == "ckpt_task_001_1"

    @pytest.mark.asyncio
    async def test_list_for_task_newest_first(self) -> None:
        store = InMemoryCheckpointAdapter()
        await store.save_snapshot(_make_checkpoint())
        await store.save_snapshot(_make_checkpoint())
        await store.save_snapshot(_make_checkpoint())
        snapshots = await store.list_for_task("task_001")
        assert [s.seq for s in snapshots] == [3, 2, 1]

    @pytest.mark.asyncio
    async def test_list_for_task_empty(self) -> None:
        store = InMemoryCheckpointAdapter()
        assert await store.list_for_task("nonexistent") == []

    @pytest.mark.asyncio
    async def test_load_snapshot_by_id(self) -> None:
        store = InMemoryCheckpointAdapter()
        cp = _make_checkpoint()
        cp.label = "important"
        cid = await store.save_snapshot(cp)
        loaded = await store.load_snapshot(cid)
        assert loaded is not None
        assert loaded.label == "important"
        assert loaded.checkpoint_id == cid

    @pytest.mark.asyncio
    async def test_load_snapshot_missing_returns_none(self) -> None:
        store = InMemoryCheckpointAdapter()
        assert await store.load_snapshot("ckpt_ghost_99") is None

    @pytest.mark.asyncio
    async def test_delete_snapshot(self) -> None:
        store = InMemoryCheckpointAdapter()
        cid = await store.save_snapshot(_make_checkpoint())
        await store.delete_snapshot(cid)
        assert await store.load_snapshot(cid) is None

    @pytest.mark.asyncio
    async def test_delete_snapshot_nonexistent_noop(self) -> None:
        store = InMemoryCheckpointAdapter()
        await store.delete_snapshot("ckpt_ghost_1")  # must not raise

    @pytest.mark.asyncio
    async def test_pruning_on_exceed_max(self) -> None:
        store = InMemoryCheckpointAdapter(max_snapshots=3)
        for _ in range(5):
            await store.save_snapshot(_make_checkpoint())
        snapshots = await store.list_for_task("task_001")
        assert len(snapshots) == 3
        assert [s.seq for s in snapshots] == [5, 4, 3]

    @pytest.mark.asyncio
    async def test_snapshots_isolated_per_task(self) -> None:
        store = InMemoryCheckpointAdapter()
        await store.save_snapshot(_make_checkpoint("task_a"))
        await store.save_snapshot(_make_checkpoint("task_b"))
        a_snaps = await store.list_for_task("task_a")
        b_snaps = await store.list_for_task("task_b")
        assert len(a_snaps) == 1
        assert len(b_snaps) == 1

    @pytest.mark.asyncio
    async def test_crash_recovery_and_snapshots_independent(self) -> None:
        store = InMemoryCheckpointAdapter()
        cp = _make_checkpoint()
        await store.save(cp)
        cid = await store.save_snapshot(_make_checkpoint())
        # Crash-recovery still accessible
        assert await store.load("task_001") is not None
        # Snapshot still accessible
        assert await store.load_snapshot(cid) is not None


# ---------------------------------------------------------------------------
# DiskCheckpointAdapter — gzip + 0600 + sequential + pruning
# ---------------------------------------------------------------------------


class TestDiskCheckpointAdapterSnapshots:
    @pytest.mark.asyncio
    async def test_snapshot_written_as_gz_file(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        cp = _make_checkpoint()
        cid = await adapter.save_snapshot(cp)
        task_dir = tmp_path / "task_001"
        gz_files = list(task_dir.glob("*.json.gz"))
        assert len(gz_files) == 1
        assert cid in gz_files[0].name

    @pytest.mark.asyncio
    async def test_snapshot_file_permissions_0600(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        await adapter.save_snapshot(_make_checkpoint())
        task_dir = tmp_path / "task_001"
        gz_file = next(task_dir.glob("*.json.gz"))
        file_mode = stat.S_IMODE(gz_file.stat().st_mode)
        assert file_mode == 0o600

    @pytest.mark.asyncio
    async def test_snapshot_file_is_valid_gzip(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        await adapter.save_snapshot(_make_checkpoint())
        task_dir = tmp_path / "task_001"
        gz_file = next(task_dir.glob("*.json.gz"))
        data = json.loads(gzip.decompress(gz_file.read_bytes()))
        assert data["task_id"] == "task_001"

    @pytest.mark.asyncio
    async def test_snapshot_roundtrip(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        cp = _make_checkpoint()
        cp.label = "after refactor"
        cp.tags = ["green"]
        cp.memory_context = "some ctx"
        cid = await adapter.save_snapshot(cp)
        loaded = await adapter.load_snapshot(cid)
        assert loaded is not None
        assert loaded.label == "after refactor"
        assert loaded.tags == ["green"]
        assert loaded.memory_context == "some ctx"
        assert loaded.checkpoint_id == cid

    @pytest.mark.asyncio
    async def test_sequential_ids_across_saves(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        cid1 = await adapter.save_snapshot(_make_checkpoint())
        cid2 = await adapter.save_snapshot(_make_checkpoint())
        assert cid1 == "ckpt_task_001_1"
        assert cid2 == "ckpt_task_001_2"

    @pytest.mark.asyncio
    async def test_list_for_task_newest_first(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        await adapter.save_snapshot(_make_checkpoint())
        time.sleep(0.01)
        await adapter.save_snapshot(_make_checkpoint())
        snapshots = await adapter.list_for_task("task_001")
        assert len(snapshots) == 2
        assert snapshots[0].seq > snapshots[1].seq

    @pytest.mark.asyncio
    async def test_delete_snapshot_removes_file(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        cid = await adapter.save_snapshot(_make_checkpoint())
        await adapter.delete_snapshot(cid)
        assert await adapter.load_snapshot(cid) is None
        task_dir = tmp_path / "task_001"
        assert list(task_dir.glob("*.json.gz")) == []

    @pytest.mark.asyncio
    async def test_pruning_removes_oldest(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path, max_snapshots_per_task=2)
        await adapter.save_snapshot(_make_checkpoint())
        await adapter.save_snapshot(_make_checkpoint())
        await adapter.save_snapshot(_make_checkpoint())
        snapshots = await adapter.list_for_task("task_001")
        assert len(snapshots) == 2
        seqs = [s.seq for s in snapshots]
        assert 1 not in seqs  # oldest pruned

    @pytest.mark.asyncio
    async def test_load_snapshot_nonexistent_returns_none(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        assert await adapter.load_snapshot("ckpt_ghost_99") is None

    @pytest.mark.asyncio
    async def test_crash_recovery_still_works_alongside_snapshots(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        cp = _make_checkpoint()
        await adapter.save(cp)
        await adapter.save_snapshot(_make_checkpoint())
        loaded_crash = await adapter.load("task_001")
        assert loaded_crash is not None

    @pytest.mark.asyncio
    async def test_crash_checkpoint_is_gzip(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        await adapter.save(_make_checkpoint())
        gz_file = tmp_path / "task_001.json.gz"
        assert gz_file.exists()
        data = json.loads(gzip.decompress(gz_file.read_bytes()))
        assert data["task_id"] == "task_001"

    @pytest.mark.asyncio
    async def test_crash_checkpoint_permissions_0600(self, tmp_path: Path) -> None:
        adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
        await adapter.save(_make_checkpoint())
        gz_file = tmp_path / "task_001.json.gz"
        assert stat.S_IMODE(gz_file.stat().st_mode) == 0o600


# ---------------------------------------------------------------------------
# Agent auto-snapshot triggers
# ---------------------------------------------------------------------------


class TestAgentAutoSnapshotTriggers:
    @pytest.mark.asyncio
    async def test_n_tools_trigger_fires_at_cadence(self) -> None:
        """Named snapshot saved after every N=2 tool calls."""
        store = InMemoryCheckpointAdapter()
        llm = MockLLM(
            [
                _make_tool_response("tc1"),
                _make_tool_response("tc2"),
                make_text_response("done"),
            ]
        )
        agent = RavnAgent(
            llm=llm,
            tools=[EchoTool()],
            channel=InMemoryChannel(),
            permission=AllowAllPermission(),
            system_prompt="test",
            model="claude-sonnet-4-6",
            max_tokens=512,
            max_iterations=10,
            checkpoint_port=store,
            task_id="n_tools_task",
            checkpoint_every_n_tools=2,
        )
        await agent.run_turn("go")
        snapshots = await store.list_for_task("n_tools_task")
        # After 2 tool calls, the trigger fires once.
        assert len(snapshots) >= 1
        assert any("auto: after 2 tools" in s.label for s in snapshots)

    @pytest.mark.asyncio
    async def test_budget_milestone_trigger(self) -> None:
        """Named snapshot saved when iteration budget crosses configured fractions."""
        store = InMemoryCheckpointAdapter()
        from ravn.budget import IterationBudget

        budget = IterationBudget(total=4, near_limit_threshold=0.8)

        # 2 tool calls + final text = 2 budget units consumed → 50%
        llm = MockLLM(
            [
                _make_tool_response("tc1"),
                _make_tool_response("tc2"),
                make_text_response("done"),
            ]
        )
        agent = RavnAgent(
            llm=llm,
            tools=[EchoTool()],
            channel=InMemoryChannel(),
            permission=AllowAllPermission(),
            system_prompt="test",
            model="claude-sonnet-4-6",
            max_tokens=512,
            max_iterations=10,
            iteration_budget=budget,
            checkpoint_port=store,
            task_id="milestone_task",
            budget_milestone_fractions=[0.5],
        )
        await agent.run_turn("go")
        snapshots = await store.list_for_task("milestone_task")
        assert any("50%" in s.label for s in snapshots)

    @pytest.mark.asyncio
    async def test_destructive_tool_pre_snapshot(self) -> None:
        """Named snapshot saved before a destructive tool is called."""
        store = InMemoryCheckpointAdapter()

        # Use EchoTool renamed to 'write_file' to simulate a destructive tool.
        class MockWriteFileTool(EchoTool):
            @property
            def name(self) -> str:  # type: ignore[override]
                return "write_file"

        write_file_response = LLMResponse(
            content="",
            tool_calls=[ToolCall(id="tc1", name="write_file", input={"msg": "x"})],
            stop_reason=StopReason.TOOL_USE,
            usage=TokenUsage(input_tokens=5, output_tokens=2),
        )
        llm = MockLLM([write_file_response, make_text_response("ok")])

        agent = RavnAgent(
            llm=llm,
            tools=[MockWriteFileTool()],
            channel=InMemoryChannel(),
            permission=AllowAllPermission(),
            system_prompt="test",
            model="claude-sonnet-4-6",
            max_tokens=512,
            max_iterations=10,
            checkpoint_port=store,
            task_id="destructive_task",
            auto_checkpoint_before_destructive=True,
        )
        await agent.run_turn("write something")
        snapshots = await store.list_for_task("destructive_task")
        assert any("before write_file" in s.label for s in snapshots)

    @pytest.mark.asyncio
    async def test_no_snapshot_when_triggers_disabled(self) -> None:
        """No named snapshots when all trigger settings are off."""
        store = InMemoryCheckpointAdapter()
        llm = MockLLM([_make_tool_response(), make_text_response("done")])
        agent = RavnAgent(
            llm=llm,
            tools=[EchoTool()],
            channel=InMemoryChannel(),
            permission=AllowAllPermission(),
            system_prompt="test",
            model="claude-sonnet-4-6",
            max_tokens=512,
            max_iterations=10,
            checkpoint_port=store,
            task_id="no_trigger_task",
            checkpoint_every_n_tools=0,
            auto_checkpoint_before_destructive=False,
            budget_milestone_fractions=[],
        )
        await agent.run_turn("go")
        snapshots = await store.list_for_task("no_trigger_task")
        assert snapshots == []


# ---------------------------------------------------------------------------
# Resume flow integration test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resume_from_named_snapshot() -> None:
    """Session can be restored from a named snapshot and continue from that state."""
    store = InMemoryCheckpointAdapter()

    # Save a named snapshot with some message history and a todo
    from ravn.domain.models import Message, TodoItem, TodoStatus

    original_session = Session()
    original_session.messages.append(Message(role="user", content="original prompt"))
    original_session.messages.append(Message(role="assistant", content="I started working"))
    original_session.upsert_todo(
        TodoItem(id="t1", content="do the thing", status=TodoStatus.IN_PROGRESS, priority=1)
    )

    cp = Checkpoint(
        task_id="resume_task",
        user_input="original prompt",
        messages=[{"role": m.role, "content": m.content} for m in original_session.messages],
        todos=[
            {"id": t.id, "content": t.content, "status": str(t.status), "priority": t.priority}
            for t in original_session.todos
        ],
        iteration_budget_consumed=5,
        iteration_budget_total=90,
        last_tool_call=None,
        last_tool_result=None,
        partial_response="",
        interrupted_by=None,
        label="pre-refactor",
    )
    checkpoint_id = await store.save_snapshot(cp)

    # Restore into a fresh session
    loaded = await store.load_snapshot(checkpoint_id)
    assert loaded is not None

    restored = Session()
    for raw in loaded.messages:
        restored.messages.append(Message(role=raw["role"], content=raw["content"]))
    for raw in loaded.todos:
        status = TodoStatus(raw.get("status", "pending"))
        restored.upsert_todo(
            TodoItem(id=raw["id"], content=raw["content"], status=status, priority=raw["priority"])
        )

    # Verify restored state matches original
    assert len(restored.messages) == len(original_session.messages)
    assert restored.messages[0].content == "original prompt"
    assert len(restored.todos) == 1
    assert restored.todos[0].id == "t1"

    # Agent continues from restored session without restarting from scratch
    llm = MockLLM([make_text_response("resumed successfully")])
    agent = RavnAgent(
        llm=llm,
        tools=[],
        channel=InMemoryChannel(),
        permission=AllowAllPermission(),
        system_prompt="test",
        model="claude-sonnet-4-6",
        max_tokens=512,
        max_iterations=5,
        session=restored,
        checkpoint_port=store,
        task_id="resume_task",
    )
    result = await agent.run_turn("continue")
    assert result.response == "resumed successfully"
    # Session should now have 4 messages: 2 restored + 1 new user + 1 new assistant
    assert len(restored.messages) == 4


@pytest.mark.asyncio
async def test_snapshot_label_preserved_in_disk_roundtrip(tmp_path: Path) -> None:
    adapter = DiskCheckpointAdapter(checkpoint_dir=tmp_path)
    cp = _make_checkpoint()
    cp.label = "after unit tests pass"
    cp.tags = ["green", "coverage-ok"]
    cid = await adapter.save_snapshot(cp)
    loaded = await adapter.load_snapshot(cid)
    assert loaded is not None
    assert loaded.label == "after unit tests pass"
    assert loaded.tags == ["green", "coverage-ok"]
