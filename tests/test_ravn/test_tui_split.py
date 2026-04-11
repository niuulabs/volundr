"""Unit tests for the Ravn TUI split tree (SplitTree, PaneNode, SplitNode)."""

from __future__ import annotations

from ravn.tui.widgets.split import (
    PaneNode,
    SplitNode,
    SplitTree,
    _collect_panes,
    _find_parent,
    _node_from_dict,
)

# ---------------------------------------------------------------------------
# PaneNode
# ---------------------------------------------------------------------------


def test_pane_node_is_leaf() -> None:
    pane = PaneNode()
    assert pane.is_leaf is True


def test_pane_node_defaults() -> None:
    pane = PaneNode()
    assert pane.view_type == "flokk"
    assert pane.target is None
    assert pane.pane_id != ""


def test_pane_node_serialise_roundtrip() -> None:
    pane = PaneNode(view_type="chat", target="tanngrisnir")
    data = pane.to_dict()
    assert data["type"] == "leaf"
    assert data["view"] == "chat"
    assert data["target"] == "tanngrisnir"

    restored = PaneNode.from_dict(data)
    assert restored.view_type == "chat"
    assert restored.target == "tanngrisnir"
    assert restored.pane_id == pane.pane_id


# ---------------------------------------------------------------------------
# SplitNode
# ---------------------------------------------------------------------------


def test_split_node_is_not_leaf() -> None:
    left = PaneNode()
    right = PaneNode()
    node = SplitNode(left=left, right=right)
    assert node.is_leaf is False


def test_split_node_serialise_roundtrip() -> None:
    left = PaneNode(view_type="events")
    right = PaneNode(view_type="tasks")
    node = SplitNode(left=left, right=right, direction="vertical", ratio=0.3)
    data = node.to_dict()
    assert data["type"] == "branch"
    assert data["direction"] == "vertical"
    assert data["ratio"] == 0.3

    restored = SplitNode.from_dict(data)
    assert restored.direction == "vertical"
    assert restored.ratio == 0.3
    assert isinstance(restored.left, PaneNode)
    assert restored.left.view_type == "events"


def test_node_from_dict_leaf() -> None:
    data = {"type": "leaf", "view": "mimir"}
    node = _node_from_dict(data)
    assert isinstance(node, PaneNode)
    assert node.view_type == "mimir"


def test_node_from_dict_branch() -> None:
    data = {
        "type": "branch",
        "direction": "horizontal",
        "ratio": 0.5,
        "left": {"type": "leaf", "view": "flokk"},
        "right": {"type": "leaf", "view": "chat"},
    }
    node = _node_from_dict(data)
    assert isinstance(node, SplitNode)
    assert node.direction == "horizontal"


# ---------------------------------------------------------------------------
# SplitTree — basic construction
# ---------------------------------------------------------------------------


def test_split_tree_starts_as_single_pane() -> None:
    tree = SplitTree()
    panes = tree.all_panes()
    assert len(panes) == 1
    assert isinstance(panes[0], PaneNode)


# ---------------------------------------------------------------------------
# Split operations
# ---------------------------------------------------------------------------


def test_split_vertical_creates_two_panes() -> None:
    tree = SplitTree()
    original_id = tree.all_panes()[0].pane_id
    new_id = tree.split_vertical(original_id)
    panes = tree.all_panes()
    assert len(panes) == 2
    ids = [p.pane_id for p in panes]
    assert original_id in ids
    assert new_id in ids


def test_split_horizontal_creates_two_panes() -> None:
    tree = SplitTree()
    original_id = tree.all_panes()[0].pane_id
    tree.split_horizontal(original_id)
    assert len(tree.all_panes()) == 2
    assert tree.root.is_leaf is False
    assert isinstance(tree.root, SplitNode)
    assert tree.root.direction == "vertical"


def test_split_creates_correct_direction() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.split_vertical(pid)
    assert isinstance(tree.root, SplitNode)
    assert tree.root.direction == "horizontal"


def test_nested_splits() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    new1 = tree.split_vertical(pid)
    tree.split_horizontal(new1)
    assert len(tree.all_panes()) == 3


def test_deep_nested_splits() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    for _ in range(4):
        pid = tree.split_vertical(pid)
    assert len(tree.all_panes()) == 5


# ---------------------------------------------------------------------------
# Close pane
# ---------------------------------------------------------------------------


def test_close_pane_reduces_count() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    new_id = tree.split_vertical(pid)
    assert len(tree.all_panes()) == 2
    result = tree.close_pane(new_id)
    assert result is True
    assert len(tree.all_panes()) == 1


def test_close_only_pane_fails() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    result = tree.close_pane(pid)
    assert result is False
    assert len(tree.all_panes()) == 1


def test_close_pane_sibling_expands() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    new_id = tree.split_vertical(pid)
    tree.close_pane(pid)
    remaining = tree.all_panes()
    assert len(remaining) == 1
    assert remaining[0].pane_id == new_id


def test_close_middle_pane() -> None:
    tree = SplitTree()
    pid0 = tree.all_panes()[0].pane_id
    pid1 = tree.split_vertical(pid0)
    tree.split_vertical(pid1)
    assert len(tree.all_panes()) == 3
    tree.close_pane(pid1)
    assert len(tree.all_panes()) == 2


# ---------------------------------------------------------------------------
# Set view
# ---------------------------------------------------------------------------


def test_set_view() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    result = tree.set_view(pid, "chat", "tanngrisnir")
    assert result is True
    pane = tree.find_pane(pid)
    assert pane is not None
    assert pane.view_type == "chat"
    assert pane.target == "tanngrisnir"


def test_set_view_nonexistent_pane() -> None:
    tree = SplitTree()
    result = tree.set_view("nonexistent", "chat")
    assert result is False


# ---------------------------------------------------------------------------
# Resize
# ---------------------------------------------------------------------------


def test_resize_adjusts_ratio() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.split_vertical(pid)
    tree.resize(pid, 0.1)
    root = tree.root
    assert isinstance(root, SplitNode)
    assert abs(root.ratio - 0.6) < 1e-9


def test_resize_clamps_at_min() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.split_vertical(pid)
    # Resize far beyond minimum
    for _ in range(10):
        tree.resize(pid, -0.1)
    root = tree.root
    assert isinstance(root, SplitNode)
    assert root.ratio >= 0.1


def test_resize_clamps_at_max() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.split_vertical(pid)
    for _ in range(10):
        tree.resize(pid, 0.1)
    root = tree.root
    assert isinstance(root, SplitNode)
    assert root.ratio <= 0.9


# ---------------------------------------------------------------------------
# Equalise
# ---------------------------------------------------------------------------


def test_equalise_resets_ratios() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.split_vertical(pid)
    tree.resize(pid, 0.2)
    tree.equalise()
    root = tree.root
    assert isinstance(root, SplitNode)
    assert root.ratio == 0.5


# ---------------------------------------------------------------------------
# Swap
# ---------------------------------------------------------------------------


def test_swap_exchanges_panes() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.split_vertical(pid)
    root = tree.root
    assert isinstance(root, SplitNode)
    tree.swap(pid)
    # After swap the original left should now be on the right
    assert root.left is not None


# ---------------------------------------------------------------------------
# Rotate
# ---------------------------------------------------------------------------


def test_rotate_swaps_children() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.split_vertical(pid)
    root = tree.root
    assert isinstance(root, SplitNode)
    original_left = root.left
    original_right = root.right
    tree.rotate(pid)
    assert root.left is original_right
    assert root.right is original_left


def test_rotate_single_pane_returns_false() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    result = tree.rotate(pid)
    assert result is False


# ---------------------------------------------------------------------------
# Navigation
# ---------------------------------------------------------------------------


def test_next_pane_cycles() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    p2 = tree.split_vertical(pid)
    tree.split_vertical(p2)
    panes = tree.all_panes()
    ids = [p.pane_id for p in panes]
    assert tree.next_pane(ids[-1]).pane_id == ids[0]  # wraps


def test_prev_pane_cycles() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.split_vertical(pid)
    panes = tree.all_panes()
    ids = [p.pane_id for p in panes]
    assert tree.prev_pane(ids[0]).pane_id == ids[-1]  # wraps


def test_find_pane_returns_node() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    result = tree.find_pane(pid)
    assert result is not None
    assert result.pane_id == pid


def test_find_pane_nonexistent_returns_none() -> None:
    tree = SplitTree()
    assert tree.find_pane("no-such-id") is None


# ---------------------------------------------------------------------------
# Move to edge
# ---------------------------------------------------------------------------


def test_move_to_left_edge() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    pid2 = tree.split_vertical(pid)
    result = tree.move_to_edge(pid2, "left")
    assert result is True
    root = tree.root
    assert isinstance(root, SplitNode)
    # The moved pane should now be leftmost
    assert root.left.is_leaf
    assert isinstance(root.left, PaneNode)
    assert root.left.pane_id == pid2


def test_move_to_right_edge() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.split_vertical(pid)
    result = tree.move_to_edge(pid, "right")
    assert result is True


def test_move_to_edge_single_pane_fails() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    result = tree.move_to_edge(pid, "left")
    assert result is False


# ---------------------------------------------------------------------------
# Serialisation / deserialisation
# ---------------------------------------------------------------------------


def test_serialise_single_pane() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.set_view(pid, "events", "thrudr")
    data = tree.to_dict()
    assert data["type"] == "leaf"
    assert data["view"] == "events"
    assert data["target"] == "thrudr"


def test_serialise_split_tree() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    tree.split_vertical(pid)
    data = tree.to_dict()
    assert data["type"] == "branch"
    assert "left" in data
    assert "right" in data


def test_deserialise_roundtrip() -> None:
    tree = SplitTree()
    pid = tree.all_panes()[0].pane_id
    pid2 = tree.split_vertical(pid)
    pid3 = tree.split_horizontal(pid2)
    tree.set_view(pid, "chat", "thor")
    tree.set_view(pid2, "events", None)
    tree.set_view(pid3, "mimir", "shared")

    data = tree.to_dict()
    restored = SplitTree.from_dict(data)

    panes = restored.all_panes()
    assert len(panes) == 3

    views = {p.pane_id: (p.view_type, p.target) for p in panes}
    assert views[pid] == ("chat", "thor")
    assert views[pid2] == ("events", None)
    assert views[pid3] == ("mimir", "shared")


def test_from_dict_preserves_directions() -> None:
    data = {
        "type": "branch",
        "direction": "vertical",
        "ratio": 0.4,
        "node_id": "test-node",
        "left": {"type": "leaf", "view": "flokk", "pane_id": "p1"},
        "right": {
            "type": "branch",
            "direction": "horizontal",
            "ratio": 0.6,
            "node_id": "test-node2",
            "left": {"type": "leaf", "view": "chat", "pane_id": "p2"},
            "right": {"type": "leaf", "view": "events", "pane_id": "p3"},
        },
    }
    tree = SplitTree.from_dict(data)
    root = tree.root
    assert isinstance(root, SplitNode)
    assert root.direction == "vertical"
    assert root.ratio == 0.4
    assert isinstance(root.right, SplitNode)
    assert root.right.direction == "horizontal"

    panes = tree.all_panes()
    assert len(panes) == 3


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def test_collect_panes() -> None:
    left = PaneNode(view_type="flokk")
    right = PaneNode(view_type="chat")
    branch = SplitNode(left=left, right=right)
    result: list[PaneNode] = []
    _collect_panes(branch, result)
    assert len(result) == 2
    assert result[0].view_type == "flokk"
    assert result[1].view_type == "chat"


def test_find_parent() -> None:
    left = PaneNode()
    right = PaneNode()
    branch = SplitNode(left=left, right=right)
    parent = _find_parent(branch, left.pane_id)
    assert parent is branch


def test_find_parent_not_found() -> None:
    pane = PaneNode()
    result = _find_parent(pane, "no-id")
    assert result is None
