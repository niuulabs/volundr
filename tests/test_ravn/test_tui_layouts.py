"""Unit tests for Ravn TUI layout manager."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from ravn.tui.layouts import LayoutManager

# ---------------------------------------------------------------------------
# Built-in layouts
# ---------------------------------------------------------------------------


def test_builtin_layouts_exist() -> None:
    manager = LayoutManager()
    for name in ["flokk", "cascade", "mimir", "compare", "broadcast"]:
        layout = manager.load(name)
        assert layout is not None, f"Missing built-in layout: {name}"


def test_builtin_layout_structure() -> None:
    manager = LayoutManager()
    flokk = manager.load("flokk")
    assert flokk is not None
    assert flokk["type"] in ("leaf", "branch")


def test_builtin_layouts_listed() -> None:
    manager = LayoutManager()
    names = manager.list()
    for builtin_name in ["flokk", "cascade", "mimir"]:
        assert builtin_name in names


def test_default_layout_is_flokk() -> None:
    manager = LayoutManager()
    default = manager.default()
    flokk = manager.load("flokk")
    assert default == flokk


# ---------------------------------------------------------------------------
# User-defined layouts (with temp file)
# ---------------------------------------------------------------------------


def _make_manager_with_tempdir() -> tuple[LayoutManager, Path]:
    tmp = Path(tempfile.mkdtemp())
    layout_file = tmp / "layouts.json"

    with (
        patch("ravn.tui.layouts._LAYOUT_DIR", tmp),
        patch("ravn.tui.layouts._LAYOUT_FILE", layout_file),
    ):
        manager = LayoutManager()

    return manager, layout_file


def test_save_and_load_user_layout() -> None:
    tmp = Path(tempfile.mkdtemp())
    layout_file = tmp / "layouts.json"

    with (
        patch("ravn.tui.layouts._LAYOUT_DIR", tmp),
        patch("ravn.tui.layouts._LAYOUT_FILE", layout_file),
    ):
        manager = LayoutManager()
        tree_data = {"type": "leaf", "view": "chat", "target": "test"}
        manager.save("my-layout", tree_data)
        loaded = manager.load("my-layout")

    assert loaded == tree_data


def test_saved_layout_persisted_to_disk() -> None:
    tmp = Path(tempfile.mkdtemp())
    layout_file = tmp / "layouts.json"

    with (
        patch("ravn.tui.layouts._LAYOUT_DIR", tmp),
        patch("ravn.tui.layouts._LAYOUT_FILE", layout_file),
    ):
        manager = LayoutManager()
        tree_data = {"type": "leaf", "view": "events"}
        manager.save("persisted", tree_data)

    # Reload from disk
    assert layout_file.exists()
    on_disk = json.loads(layout_file.read_text())
    assert "persisted" in on_disk


def test_delete_user_layout() -> None:
    tmp = Path(tempfile.mkdtemp())
    layout_file = tmp / "layouts.json"

    with (
        patch("ravn.tui.layouts._LAYOUT_DIR", tmp),
        patch("ravn.tui.layouts._LAYOUT_FILE", layout_file),
    ):
        manager = LayoutManager()
        manager.save("to-delete", {"type": "leaf", "view": "tasks"})
        result = manager.delete("to-delete")
        assert result is True
        assert manager.load("to-delete") is None


def test_delete_nonexistent_returns_false() -> None:
    manager = LayoutManager()
    result = manager.delete("nonexistent-layout")
    assert result is False


def test_cannot_delete_builtin_layout() -> None:
    manager = LayoutManager()
    result = manager.delete("flokk")
    assert result is False


def test_list_includes_user_layouts() -> None:
    tmp = Path(tempfile.mkdtemp())
    layout_file = tmp / "layouts.json"

    with (
        patch("ravn.tui.layouts._LAYOUT_DIR", tmp),
        patch("ravn.tui.layouts._LAYOUT_FILE", layout_file),
    ):
        manager = LayoutManager()
        manager.save("custom-1", {"type": "leaf", "view": "caps"})
        manager.save("custom-2", {"type": "leaf", "view": "cron"})
        names = manager.list()

    assert "custom-1" in names
    assert "custom-2" in names
    # Built-ins still present
    assert "flokk" in names


def test_load_nonexistent_returns_none() -> None:
    manager = LayoutManager()
    result = manager.load("nonexistent-layout")
    assert result is None


def test_corrupt_layout_file_doesnt_crash() -> None:
    tmp = Path(tempfile.mkdtemp())
    layout_file = tmp / "layouts.json"
    layout_file.write_text("not valid json {{{")

    with (
        patch("ravn.tui.layouts._LAYOUT_DIR", tmp),
        patch("ravn.tui.layouts._LAYOUT_FILE", layout_file),
    ):
        # Should not raise
        manager = LayoutManager()

    assert manager.load("flokk") is not None  # Built-ins still available
