"""Disk-based checkpoint adapter — Pi / local mode.

Stores each checkpoint as a JSON file under ``~/.ravn/checkpoints/``.
One file per task_id; save is atomic via a temporary file + rename so a
crash mid-write never leaves a corrupt checkpoint.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path

from ravn.domain.checkpoint import Checkpoint, InterruptReason
from ravn.ports.checkpoint import CheckpointPort

logger = logging.getLogger(__name__)

_DEFAULT_CHECKPOINT_DIR = Path.home() / ".ravn" / "checkpoints"


def _to_dict(checkpoint: Checkpoint) -> dict:
    return {
        "task_id": checkpoint.task_id,
        "user_input": checkpoint.user_input,
        "messages": checkpoint.messages,
        "todos": checkpoint.todos,
        "iteration_budget_consumed": checkpoint.iteration_budget_consumed,
        "iteration_budget_total": checkpoint.iteration_budget_total,
        "last_tool_call": checkpoint.last_tool_call,
        "last_tool_result": checkpoint.last_tool_result,
        "partial_response": checkpoint.partial_response,
        "interrupted_by": checkpoint.interrupted_by,
        "created_at": checkpoint.created_at.isoformat(),
    }


def _from_dict(data: dict) -> Checkpoint:
    interrupted_by_raw = data.get("interrupted_by")
    interrupted_by = InterruptReason(interrupted_by_raw) if interrupted_by_raw else None
    created_at_raw = data.get("created_at", "")
    created_at = datetime.fromisoformat(created_at_raw) if created_at_raw else datetime.now(UTC)
    return Checkpoint(
        task_id=data["task_id"],
        user_input=data.get("user_input", ""),
        messages=data.get("messages", []),
        todos=data.get("todos", []),
        iteration_budget_consumed=data.get("iteration_budget_consumed", 0),
        iteration_budget_total=data.get("iteration_budget_total", 0),
        last_tool_call=data.get("last_tool_call"),
        last_tool_result=data.get("last_tool_result"),
        partial_response=data.get("partial_response", ""),
        interrupted_by=interrupted_by,
        created_at=created_at,
    )


class DiskCheckpointAdapter(CheckpointPort):
    """Stores checkpoints as JSON files in a local directory.

    Parameters
    ----------
    checkpoint_dir:
        Directory to store checkpoint files.  Defaults to
        ``~/.ravn/checkpoints/``.
    """

    def __init__(self, checkpoint_dir: Path | str | None = None) -> None:
        self._dir = Path(checkpoint_dir) if checkpoint_dir else _DEFAULT_CHECKPOINT_DIR
        self._dir.mkdir(parents=True, exist_ok=True)

    def _path(self, task_id: str) -> Path:
        # Sanitise task_id to avoid path traversal.
        safe = task_id.replace("/", "_").replace("..", "__")
        return self._dir / f"{safe}.json"

    async def save(self, checkpoint: Checkpoint) -> None:
        data = _to_dict(checkpoint)
        target = self._path(checkpoint.task_id)
        # Atomic write: write to temp file in same dir, then rename.
        fd, tmp_path = tempfile.mkstemp(dir=self._dir, suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(data, fh, indent=2)
            os.replace(tmp_path, target)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
        logger.debug("Checkpoint saved: %s → %s", checkpoint.task_id, target)

    async def load(self, task_id: str) -> Checkpoint | None:
        path = self._path(task_id)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text())
            return _from_dict(data)
        except Exception as exc:
            logger.warning("Failed to load checkpoint %r: %s", task_id, exc)
            return None

    async def delete(self, task_id: str) -> None:
        path = self._path(task_id)
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Failed to delete checkpoint %r: %s", task_id, exc)

    async def list_task_ids(self) -> list[str]:
        files = sorted(self._dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        return [f.stem for f in files]
