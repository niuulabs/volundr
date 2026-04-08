"""SplitContainer — binary split tree for the Ravn TUI.

Every node is either:
- A **leaf** (PaneNode): holds a view_type + ravn_target.
- A **branch** (SplitNode): has two children, a direction, and a ratio.

The tree is fully serialisable to/from JSON for layout save/restore.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

Direction = Literal["horizontal", "vertical"]

_DEFAULT_RATIO = 0.5
_MIN_RATIO = 0.1
_MAX_RATIO = 0.9
_RESIZE_STEP = 0.05


# ---------------------------------------------------------------------------
# Data-model nodes — pure Python, no Textual dependency
# ---------------------------------------------------------------------------


@dataclass
class PaneNode:
    """A leaf node in the split tree."""

    pane_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    view_type: str = "flokka"
    target: str | None = None

    @property
    def is_leaf(self) -> bool:
        return True

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "leaf",
            "pane_id": self.pane_id,
            "view": self.view_type,
            "target": self.target,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PaneNode:
        return cls(
            pane_id=data.get("pane_id", str(uuid.uuid4())),
            view_type=data.get("view", "flokka"),
            target=data.get("target"),
        )


@dataclass
class SplitNode:
    """A branch node — splits space between two children."""

    left: PaneNode | SplitNode
    right: PaneNode | SplitNode
    direction: Direction = "horizontal"
    ratio: float = _DEFAULT_RATIO  # fraction of space given to *left*
    node_id: str = field(default_factory=lambda: str(uuid.uuid4()))

    @property
    def is_leaf(self) -> bool:
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "branch",
            "node_id": self.node_id,
            "direction": self.direction,
            "ratio": self.ratio,
            "left": self.left.to_dict(),
            "right": self.right.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SplitNode:
        return cls(
            left=_node_from_dict(data["left"]),
            right=_node_from_dict(data["right"]),
            direction=data.get("direction", "horizontal"),
            ratio=float(data.get("ratio", _DEFAULT_RATIO)),
            node_id=data.get("node_id", str(uuid.uuid4())),
        )


TreeNode = PaneNode | SplitNode


def _node_from_dict(data: dict[str, Any]) -> TreeNode:
    if data.get("type") == "leaf":
        return PaneNode.from_dict(data)
    return SplitNode.from_dict(data)


# ---------------------------------------------------------------------------
# SplitTree — mutating operations on the tree
# ---------------------------------------------------------------------------


class SplitTree:
    """Manages a binary split tree with mutating operations.

    All operations accept a *pane_id* (leaf node identifier) and mutate
    the tree in place.  After each mutation the caller should re-render.
    """

    def __init__(self, root: TreeNode | None = None) -> None:
        self._root: TreeNode = root or PaneNode()

    @property
    def root(self) -> TreeNode:
        return self._root

    # ------------------------------------------------------------------
    # Split operations
    # ------------------------------------------------------------------

    def split_vertical(self, pane_id: str, new_view: str = "flokka") -> str:
        """Split *pane_id* into left | right. Returns new pane_id."""
        new_pane = PaneNode(view_type=new_view)
        self._root = _replace_leaf(
            self._root,
            pane_id,
            lambda leaf: SplitNode(
                left=leaf,
                right=new_pane,
                direction="horizontal",
            ),
        )
        return new_pane.pane_id

    def split_horizontal(self, pane_id: str, new_view: str = "flokka") -> str:
        """Split *pane_id* into top | bottom. Returns new pane_id."""
        new_pane = PaneNode(view_type=new_view)
        self._root = _replace_leaf(
            self._root,
            pane_id,
            lambda leaf: SplitNode(
                left=leaf,
                right=new_pane,
                direction="vertical",
            ),
        )
        return new_pane.pane_id

    def close_pane(self, pane_id: str) -> bool:
        """Remove *pane_id*; sibling expands to fill parent. Returns True on success."""
        if self._root.is_leaf:
            # Cannot close the only pane
            return False
        new_root = _remove_leaf(self._root, pane_id)
        if new_root is None:
            return False
        self._root = new_root
        return True

    def set_view(self, pane_id: str, view_type: str, target: str | None = None) -> bool:
        """Change the view_type and target of a leaf pane."""
        leaf = self.find_pane(pane_id)
        if leaf is None:
            return False
        leaf.view_type = view_type
        leaf.target = target
        return True

    # ------------------------------------------------------------------
    # Resize operations
    # ------------------------------------------------------------------

    def resize(self, pane_id: str, delta: float) -> bool:
        """Adjust the split ratio of the branch containing *pane_id*."""
        return _adjust_ratio(self._root, pane_id, delta)

    def equalise(self) -> None:
        """Set all split ratios to 0.5."""
        _equalise(self._root)

    # ------------------------------------------------------------------
    # Swap / rotate
    # ------------------------------------------------------------------

    def swap(self, pane_id: str) -> bool:
        """Swap *pane_id* with its sibling."""
        return _swap_children(self._root, pane_id)

    def rotate(self, pane_id: str) -> bool:
        """Rotate children within the branch containing *pane_id*."""
        parent = _find_parent(self._root, pane_id)
        if parent is None or parent.is_leaf:
            return False
        assert isinstance(parent, SplitNode)
        parent.left, parent.right = parent.right, parent.left
        return True

    # ------------------------------------------------------------------
    # Navigation
    # ------------------------------------------------------------------

    def all_panes(self) -> list[PaneNode]:
        """Return all leaf nodes in left-to-right, top-to-bottom order."""
        result: list[PaneNode] = []
        _collect_panes(self._root, result)
        return result

    def find_pane(self, pane_id: str) -> PaneNode | None:
        """Find a leaf node by pane_id."""
        return _find_leaf(self._root, pane_id)

    def next_pane(self, pane_id: str) -> PaneNode | None:
        """Return the next pane in cycle order."""
        panes = self.all_panes()
        if not panes:
            return None
        ids = [p.pane_id for p in panes]
        if pane_id not in ids:
            return panes[0]
        idx = (ids.index(pane_id) + 1) % len(panes)
        return panes[idx]

    def prev_pane(self, pane_id: str) -> PaneNode | None:
        """Return the previous pane in cycle order."""
        panes = self.all_panes()
        if not panes:
            return None
        ids = [p.pane_id for p in panes]
        if pane_id not in ids:
            return panes[-1]
        idx = (ids.index(pane_id) - 1) % len(panes)
        return panes[idx]

    def pane_in_direction(
        self,
        pane_id: str,
        direction: Literal["left", "right", "up", "down"],
    ) -> PaneNode | None:
        """Return the nearest pane in the given vim direction."""
        panes = self.all_panes()
        if not panes:
            return None
        # Simple heuristic: use list order for left/up (prev) and right/down (next)
        if direction in ("right", "down"):
            return self.next_pane(pane_id)
        return self.prev_pane(pane_id)

    # ------------------------------------------------------------------
    # Move to edge
    # ------------------------------------------------------------------

    def move_to_edge(
        self,
        pane_id: str,
        edge: Literal["left", "right", "top", "bottom"],
    ) -> bool:
        """Move *pane_id* to the given screen edge (detach + re-attach at root)."""
        leaf = self.find_pane(pane_id)
        if leaf is None:
            return False
        if not self.close_pane(pane_id):
            return False
        direction: Direction = "horizontal" if edge in ("left", "right") else "vertical"
        if edge in ("left", "top"):
            self._root = SplitNode(left=leaf, right=self._root, direction=direction)
        else:
            self._root = SplitNode(left=self._root, right=leaf, direction=direction)
        return True

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return self._root.to_dict()

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SplitTree:
        return cls(root=_node_from_dict(data))


# ---------------------------------------------------------------------------
# Private recursive helpers
# ---------------------------------------------------------------------------


def _replace_leaf(
    node: TreeNode,
    pane_id: str,
    factory: Any,
) -> TreeNode:
    """Replace the leaf with *pane_id* with the result of factory(leaf)."""
    if node.is_leaf:
        assert isinstance(node, PaneNode)
        if node.pane_id == pane_id:
            return factory(node)
        return node
    assert isinstance(node, SplitNode)
    new_left = _replace_leaf(node.left, pane_id, factory)
    new_right = _replace_leaf(node.right, pane_id, factory)
    return SplitNode(
        left=new_left,
        right=new_right,
        direction=node.direction,
        ratio=node.ratio,
        node_id=node.node_id,
    )


def _remove_leaf(node: TreeNode, pane_id: str) -> TreeNode | None:
    """Remove leaf *pane_id* and return the sibling to fill its space.

    Returns None if the tree has only one pane.
    """
    if node.is_leaf:
        assert isinstance(node, PaneNode)
        if node.pane_id == pane_id:
            return None  # signal: this node is to be removed
        return node
    assert isinstance(node, SplitNode)

    # Try removing from left
    new_left = _remove_leaf(node.left, pane_id)
    if new_left is None:
        return node.right  # sibling expands

    # Try removing from right
    new_right = _remove_leaf(node.right, pane_id)
    if new_right is None:
        return node.left  # sibling expands

    return SplitNode(
        left=new_left,
        right=new_right,
        direction=node.direction,
        ratio=node.ratio,
        node_id=node.node_id,
    )


def _find_leaf(node: TreeNode, pane_id: str) -> PaneNode | None:
    if node.is_leaf:
        assert isinstance(node, PaneNode)
        return node if node.pane_id == pane_id else None
    assert isinstance(node, SplitNode)
    return _find_leaf(node.left, pane_id) or _find_leaf(node.right, pane_id)


def _find_parent(node: TreeNode, pane_id: str) -> SplitNode | None:
    """Return the branch node whose direct child is the leaf with *pane_id*."""
    if node.is_leaf:
        return None
    assert isinstance(node, SplitNode)
    if (node.left.is_leaf and isinstance(node.left, PaneNode) and node.left.pane_id == pane_id) or (
        node.right.is_leaf and isinstance(node.right, PaneNode) and node.right.pane_id == pane_id
    ):
        return node
    return _find_parent(node.left, pane_id) or _find_parent(node.right, pane_id)


def _collect_panes(node: TreeNode, result: list[PaneNode]) -> None:
    if node.is_leaf:
        assert isinstance(node, PaneNode)
        result.append(node)
        return
    assert isinstance(node, SplitNode)
    _collect_panes(node.left, result)
    _collect_panes(node.right, result)


def _adjust_ratio(node: TreeNode, pane_id: str, delta: float) -> bool:
    if node.is_leaf:
        return False
    assert isinstance(node, SplitNode)
    left_panes: list[PaneNode] = []
    _collect_panes(node.left, left_panes)
    if any(p.pane_id == pane_id for p in left_panes):
        node.ratio = max(_MIN_RATIO, min(_MAX_RATIO, node.ratio + delta))
        return True
    right_panes: list[PaneNode] = []
    _collect_panes(node.right, right_panes)
    if any(p.pane_id == pane_id for p in right_panes):
        node.ratio = max(_MIN_RATIO, min(_MAX_RATIO, node.ratio - delta))
        return True
    return _adjust_ratio(node.left, pane_id, delta) or _adjust_ratio(node.right, pane_id, delta)


def _equalise(node: TreeNode) -> None:
    if node.is_leaf:
        return
    assert isinstance(node, SplitNode)
    node.ratio = _DEFAULT_RATIO
    _equalise(node.left)
    _equalise(node.right)


def _swap_children(node: TreeNode, pane_id: str) -> bool:
    if node.is_leaf:
        return False
    assert isinstance(node, SplitNode)
    left_panes: list[PaneNode] = []
    _collect_panes(node.left, left_panes)
    right_panes: list[PaneNode] = []
    _collect_panes(node.right, right_panes)
    if any(p.pane_id == pane_id for p in left_panes + right_panes):
        node.left, node.right = node.right, node.left
        return True
    return _swap_children(node.left, pane_id) or _swap_children(node.right, pane_id)
