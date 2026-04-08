"""RavnTUI — main Textual application for the Ravn terminal operator interface."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Container
from textual.message import Message
from textual.widget import Widget
from textual.widgets import Input

from ravn.tui.commands import CommandDispatcher, CommandParseError, parse_command
from ravn.tui.connections import FlokkaManager
from ravn.tui.layouts import LayoutManager
from ravn.tui.widgets.bottom_bar import BottomBar
from ravn.tui.widgets.pane import PaneWidget
from ravn.tui.widgets.split import PaneNode, SplitNode, SplitTree, TreeNode
from ravn.tui.widgets.status_bar import StatusBar

logger = logging.getLogger(__name__)

_APP_TITLE = "ᚠ Ravn"
_RESIZE_STEP = 0.05
_ZOOM_STEP = 0.05


class RavnTUI(App[None]):
    """Ravn TUI — terminal operator interface for Flokk management.

    Supports vim/tmux-style arbitrary split layout, 8 view types,
    command mode, named layouts, broadcast, ghost mode, and live
    observability over WebSocket + SSE.
    """

    CSS_PATH = Path(__file__).parent / "app.tcss"

    BINDINGS = [
        Binding("ctrl+w", "window_action", "Window", show=False),
        Binding(":", "command_mode", "Command"),
        Binding("q", "quit", "Quit"),
        Binding("b", "broadcast", "Broadcast"),
        Binding("n", "notifications", "Notifs"),
        Binding("escape", "escape", "Escape", show=False),
    ]

    TITLE = _APP_TITLE

    # ------------------------------------------------------------------
    # Messages
    # ------------------------------------------------------------------

    class GhostMode(Message):
        def __init__(self, host: str, port: int) -> None:
            super().__init__()
            self.host = host
            self.port = port

    # ------------------------------------------------------------------
    # Init
    # ------------------------------------------------------------------

    def __init__(
        self,
        connections: list[tuple[str, int]] | None = None,
        discover: bool = False,
        layout_name: str | None = None,
        **kwargs: object,
    ) -> None:
        super().__init__(**kwargs)
        self._initial_connections = connections or []
        self._discover = discover
        self._initial_layout = layout_name

        self.flokka = FlokkaManager()
        self.layout_mgr = LayoutManager()
        self._tree = SplitTree()
        self._focused_pane_id: str | None = None
        self._zoomed: bool = False
        self._zoom_previous_tree: SplitTree | None = None
        self._notifications: list[str] = []
        self._cmd_dispatcher = CommandDispatcher()
        self._register_commands()

        # Pending ctrl+w sub-key
        self._pending_ctrl_w = False

    # ------------------------------------------------------------------
    # Compose
    # ------------------------------------------------------------------

    def compose(self) -> ComposeResult:
        yield StatusBar(flokka=self.flokka, id="status-bar")
        yield Container(id="main-container")
        yield Container(
            Input(placeholder=":  ", id="cmd-input"),
            id="cmd-input-container",
        )
        yield BottomBar(id="bottom-bar")

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def on_mount(self) -> None:
        # Load initial layout
        layout_name = self._initial_layout or "flokk"
        layout_data = self.layout_mgr.load(layout_name)
        if layout_data:
            self._tree = SplitTree.from_dict(layout_data)
        else:
            self._tree = SplitTree()

        # Connect to initial Ravens
        for host, port in self._initial_connections:
            asyncio.create_task(
                self.flokka.connect(host, port),
                name=f"connect:{host}:{port}",
            )

        if self._discover:
            asyncio.create_task(self._mdns_discover(), name="mdns-discover")

        await self._render_tree()

        # Focus the first pane
        panes = self._tree.all_panes()
        if panes:
            self._focused_pane_id = panes[0].pane_id
            self._focus_pane(panes[0].pane_id)

    async def _mdns_discover(self) -> None:
        """Attempt mDNS service discovery for Ravn daemons."""
        try:
            from zeroconf import ServiceBrowser
            from zeroconf.asyncio import AsyncZeroconf

            async with AsyncZeroconf() as azc:

                def on_service_added(zeroconf: Any, service_type: str, name: str) -> None:
                    info = zeroconf.get_service_info(service_type, name)
                    if info:
                        host = info.server or info.parsed_addresses()[0]
                        port = info.port or 7477
                        asyncio.create_task(self.flokka.connect(host, port))

                _browser = ServiceBrowser(  # noqa: F841
                    azc.zeroconf,
                    "_ravn._tcp.local.",
                    handlers=[on_service_added],
                )
                await asyncio.sleep(float("inf"))
        except ImportError:
            logger.debug("zeroconf not available — mDNS discovery disabled")
        except Exception:
            logger.debug("mDNS discovery failed")

    # ------------------------------------------------------------------
    # Rendering
    # ------------------------------------------------------------------

    async def _render_tree(self) -> None:
        container = self.query_one("#main-container", Container)
        await container.remove_children()
        widget = self._build_widget(self._tree.root)
        await container.mount(widget)

    def _build_widget(self, node: TreeNode) -> Widget:
        if node.is_leaf:
            assert isinstance(node, PaneNode)
            pane = PaneWidget(
                pane_id=node.pane_id,
                view_type=node.view_type,
                target=node.target,
                flokka=self.flokka,
                id=f"pane-{node.pane_id.replace('-', '_')}",
            )
            return pane

        assert isinstance(node, SplitNode)
        css_class = "split-h" if node.direction == "horizontal" else "split-v"
        left_widget = self._build_widget(node.left)
        right_widget = self._build_widget(node.right)

        # Apply ratio as CSS width/height fraction
        if node.direction == "horizontal":
            left_widget.styles.width = f"{int(node.ratio * 100)}%"
            right_widget.styles.width = f"{int((1 - node.ratio) * 100)}%"
        else:
            left_widget.styles.height = f"{int(node.ratio * 100)}%"
            right_widget.styles.height = f"{int((1 - node.ratio) * 100)}%"

        return Container(left_widget, right_widget, classes=css_class)

    # ------------------------------------------------------------------
    # Pane focus management
    # ------------------------------------------------------------------

    def _focus_pane(self, pane_id: str) -> None:
        self._focused_pane_id = pane_id
        try:
            pane = self.query_one(f"#pane-{pane_id.replace('-', '_')}", PaneWidget)
            pane.focus()
            # Update bottom bar context
            self.query_one("#bottom-bar", BottomBar).set_context(pane._view_type)
            self.query_one("#status-bar", StatusBar).set_active_ravn(pane._target or "—")
        except Exception:
            pass

    # ------------------------------------------------------------------
    # ctrl+w window actions
    # ------------------------------------------------------------------

    async def action_window_action(self) -> None:
        """Set pending flag — next key selects the window sub-action."""
        self._pending_ctrl_w = True

    async def on_key(self, event: Any) -> None:
        if not self._pending_ctrl_w:
            return
        self._pending_ctrl_w = False
        key = event.key

        match key:
            case "v":
                await self._split_current("vertical")
            case "s":
                await self._split_current("horizontal")
            case "q":
                await self._close_current()
            case "w":
                self._focus_next_pane()
            case "h":
                self._focus_direction("left")
            case "j":
                self._focus_direction("down")
            case "k":
                self._focus_direction("up")
            case "l":
                self._focus_direction("right")
            case "H":
                await self._move_to_edge("left")
            case "J":
                await self._move_to_edge("bottom")
            case "K":
                await self._move_to_edge("top")
            case "L":
                await self._move_to_edge("right")
            case "x":
                await self._swap_current()
            case "equal":
                self._tree.equalise()
                await self._render_tree()
            case "z":
                await self._toggle_zoom()
            case "less_than_sign" | "<":
                await self._resize_current(-_RESIZE_STEP)
            case "greater_than_sign" | ">":
                await self._resize_current(_RESIZE_STEP)
            case "plus" | "+":
                await self._resize_current_height(_RESIZE_STEP)
            case "minus" | "-":
                await self._resize_current_height(-_RESIZE_STEP)
            case "r":
                await self._rotate_current()

    async def _split_current(self, direction: str) -> None:
        if not self._focused_pane_id:
            return
        if direction == "vertical":
            new_id = self._tree.split_vertical(self._focused_pane_id)
        else:
            new_id = self._tree.split_horizontal(self._focused_pane_id)
        await self._render_tree()
        self._focus_pane(new_id)

    async def _close_current(self) -> None:
        if not self._focused_pane_id:
            return
        panes = self._tree.all_panes()
        if len(panes) <= 1:
            return
        # Find a sibling to focus after closing
        new_focus = self._tree.next_pane(self._focused_pane_id)
        self._tree.close_pane(self._focused_pane_id)
        await self._render_tree()
        if new_focus:
            self._focus_pane(new_focus.pane_id)

    def _focus_next_pane(self) -> None:
        if not self._focused_pane_id:
            return
        pane = self._tree.next_pane(self._focused_pane_id)
        if pane:
            self._focus_pane(pane.pane_id)

    def _focus_direction(self, direction: str) -> None:
        if not self._focused_pane_id:
            return
        pane = self._tree.pane_in_direction(self._focused_pane_id, direction)  # type: ignore[arg-type]
        if pane and pane.pane_id != self._focused_pane_id:
            self._focus_pane(pane.pane_id)

    async def _move_to_edge(self, edge: str) -> None:
        if not self._focused_pane_id:
            return
        self._tree.move_to_edge(self._focused_pane_id, edge)  # type: ignore[arg-type]
        await self._render_tree()
        self._focus_pane(self._focused_pane_id)

    async def _swap_current(self) -> None:
        if not self._focused_pane_id:
            return
        self._tree.swap(self._focused_pane_id)
        await self._render_tree()
        self._focus_pane(self._focused_pane_id)

    async def _toggle_zoom(self) -> None:
        if not self._focused_pane_id:
            return
        if self._zoomed:
            if self._zoom_previous_tree:
                self._tree = self._zoom_previous_tree
                self._zoom_previous_tree = None
            self._zoomed = False
            await self._render_tree()
            self._focus_pane(self._focused_pane_id)
            return
        # Save tree, create single-pane tree with current pane
        leaf = self._tree.find_pane(self._focused_pane_id)
        if not leaf:
            return
        self._zoom_previous_tree = SplitTree.from_dict(self._tree.to_dict())
        self._tree = SplitTree(
            PaneNode(
                pane_id=leaf.pane_id,
                view_type=leaf.view_type,
                target=leaf.target,
            )
        )
        self._zoomed = True
        await self._render_tree()
        self._focus_pane(self._focused_pane_id)

    async def _resize_current(self, delta: float) -> None:
        if not self._focused_pane_id:
            return
        self._tree.resize(self._focused_pane_id, delta)
        await self._render_tree()
        self._focus_pane(self._focused_pane_id)

    async def _resize_current_height(self, delta: float) -> None:
        # Use negative delta for vertical splits
        await self._resize_current(-delta)

    async def _rotate_current(self) -> None:
        if not self._focused_pane_id:
            return
        self._tree.rotate(self._focused_pane_id)
        await self._render_tree()
        self._focus_pane(self._focused_pane_id)

    # ------------------------------------------------------------------
    # Command mode
    # ------------------------------------------------------------------

    async def action_command_mode(self) -> None:
        container = self.query_one("#cmd-input-container", Container)
        container.add_class("visible")
        self.query_one("#cmd-input", Input).focus()

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.input.id != "cmd-input":
            return
        text = event.value.strip()
        event.input.clear()
        self.query_one("#cmd-input-container", Container).remove_class("visible")
        self.restore_focus()

        if not text:
            return
        raw = text.lstrip(":")
        try:
            cmd = parse_command(raw)
            await self._cmd_dispatcher.dispatch(cmd)
        except CommandParseError as exc:
            self.notify(str(exc), severity="error")

    def restore_focus(self) -> None:
        if self._focused_pane_id:
            self._focus_pane(self._focused_pane_id)

    async def action_escape(self) -> None:
        container = self.query_one("#cmd-input-container", Container)
        if "visible" in container.classes:
            container.remove_class("visible")
            self.restore_focus()

    # ------------------------------------------------------------------
    # Command handlers
    # ------------------------------------------------------------------

    def _register_commands(self) -> None:
        d = self._cmd_dispatcher
        d.register("connect", self._cmd_connect)
        d.register("disconnect", self._cmd_disconnect)
        d.register("view", self._cmd_view)
        d.register("layout", self._cmd_layout)
        d.register("spawn", self._cmd_spawn)
        d.register("broadcast", self._cmd_broadcast)
        d.register("pipe", self._cmd_pipe)
        d.register("yank", self._cmd_yank)
        d.register("filter", self._cmd_filter)
        d.register("ingest", self._cmd_ingest)
        d.register("checkpoint", self._cmd_checkpoint)
        d.register("resume", self._cmd_resume)
        d.register("quit", self._cmd_quit)
        d.register("q", self._cmd_quit)

    async def _cmd_connect(self, host_port: str = "") -> None:
        if ":" not in host_port:
            self.notify("Usage: connect host:port", severity="error")
            return
        host, port_str = host_port.rsplit(":", 1)
        try:
            port = int(port_str)
        except ValueError:
            self.notify(f"Invalid port: {port_str}", severity="error")
            return
        await self.flokka.connect(host, port)
        self.notify(f"Connecting to {host}:{port}")

    async def _cmd_disconnect(self, name: str = "") -> None:
        await self.flokka.disconnect(name)
        self.notify(f"Disconnected {name}")

    async def _cmd_view(self, view_type: str = "flokka", target: str | None = None) -> None:
        if not self._focused_pane_id:
            return
        self._tree.set_view(self._focused_pane_id, view_type, target)
        try:
            pane_id = self._focused_pane_id
            pane = self.query_one(f"#pane-{pane_id.replace('-', '_')}", PaneWidget)
            pane.assign_view(view_type, target, self.flokka)
            self.query_one("#bottom-bar", BottomBar).set_context(view_type)
        except Exception:
            await self._render_tree()

    async def _cmd_layout(self, subcommand: str = "list", name: str = "") -> None:
        match subcommand:
            case "save":
                if not name:
                    self.notify("Usage: layout save <name>", severity="error")
                    return
                self.layout_mgr.save(name, self._tree.to_dict())
                self.notify(f"Layout saved: {name}")
            case "load":
                if not name:
                    self.notify("Usage: layout load <name>", severity="error")
                    return
                data = self.layout_mgr.load(name)
                if not data:
                    self.notify(f"Layout not found: {name}", severity="error")
                    return
                self._tree = SplitTree.from_dict(data)
                await self._render_tree()
                panes = self._tree.all_panes()
                if panes:
                    self._focus_pane(panes[0].pane_id)
                self.notify(f"Layout loaded: {name}")
            case "list":
                names = ", ".join(self.layout_mgr.list())
                self.notify(f"Layouts: {names}")

    async def _cmd_spawn(self, count: str = "1", persona: str = "") -> None:
        self.notify("Spawn not yet wired to cascade API")

    async def _cmd_broadcast(self, *args: str) -> None:
        message = " ".join(args)
        if not message:
            self.notify("Usage: broadcast <message>", severity="error")
            return
        results = await self.flokka.broadcast(message)
        self.notify(f"Broadcast to {len(results)} Ravens")

    async def action_broadcast(self) -> None:
        # Open command mode pre-filled with broadcast
        container = self.query_one("#cmd-input-container", Container)
        container.add_class("visible")
        inp = self.query_one("#cmd-input", Input)
        inp.value = "broadcast "
        inp.focus()

    async def action_notifications(self) -> None:
        if self._notifications:
            self.notify("\n".join(self._notifications[-5:]))
        else:
            self.notify("No notifications")

    async def _cmd_pipe(self, filename: str = "") -> None:
        self.notify(f"Pipe to {filename} not yet implemented")

    async def _cmd_yank(self) -> None:
        self.notify("Yank not yet implemented")

    async def _cmd_filter(self, event_type: str = "all") -> None:
        self.notify(f"Filter: {event_type}")

    async def _cmd_ingest(self, url: str = "") -> None:
        self.notify(f"Ingest: {url}")

    async def _cmd_checkpoint(self, label: str = "") -> None:
        self.notify(f"Checkpoint: {label}")

    async def _cmd_resume(self, task_id: str = "") -> None:
        self.notify(f"Resume: {task_id}")

    async def _cmd_quit(self) -> None:
        self.exit()

    # ------------------------------------------------------------------
    # Ghost mode
    # ------------------------------------------------------------------

    async def on_ravn_t_u_i_ghost_mode(self, message: GhostMode) -> None:
        conn = await self.flokka.connect(message.host, message.port, ghost=True)
        self.notify(f"Ghost mode: {conn.name}")
