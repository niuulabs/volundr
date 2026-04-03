"""Raids TUI page — list raids with status, confidence, and actions."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from textual.app import ComposeResult
from textual.containers import VerticalScroll
from textual.message import Message
from textual.widget import Widget
from textual.widgets import Input, Static

from cli.tui.theme import (
    ACCENT_AMBER,
    ACCENT_CYAN,
    ACCENT_EMERALD,
    ACCENT_INDIGO,
    ACCENT_ORANGE,
    ACCENT_PURPLE,
    ACCENT_RED,
    BG_SECONDARY,
    TEXT_MUTED,
    TEXT_PRIMARY,
    TEXT_SECONDARY,
)
from cli.tui.widgets.metric_card import MetricCard, MetricRow
from cli.tui.widgets.tabs import NiuuTabs

if TYPE_CHECKING:
    from niuu.cli_api_client import CLIAPIClient

# Filter tabs matching RaidStatus values.
_RAID_TABS = ["All", "Pending", "Queued", "Running", "Review", "Escalated"]

# RaidStatus → display color.
_RAID_STATUS_COLORS: dict[str, str] = {
    "PENDING": ACCENT_PURPLE,
    "QUEUED": ACCENT_AMBER,
    "RUNNING": ACCENT_EMERALD,
    "REVIEW": ACCENT_CYAN,
    "ESCALATED": ACCENT_ORANGE,
    "MERGED": ACCENT_INDIGO,
    "FAILED": ACCENT_RED,
}


class RaidRow(Widget):
    """A single raid entry in the list."""

    DEFAULT_CSS = """
    RaidRow {
        height: auto;
        padding: 1 2;
        border-bottom: solid #27272a;
        background: #18181b;
    }
    """

    def __init__(self, raid: dict[str, Any], **kwargs: object) -> None:
        super().__init__(**kwargs)
        self._raid = raid

    @property
    def raid(self) -> dict[str, Any]:
        return self._raid

    def compose(self) -> ComposeResult:
        raid = self._raid
        name = raid.get("name", "Unknown")
        status = raid.get("status", "PENDING")
        confidence = raid.get("confidence", 0.0)
        session_id = raid.get("session_id") or "—"
        raid_id = str(raid.get("id", ""))[:8]
        retry_count = raid.get("retry_count", 0)

        color = _RAID_STATUS_COLORS.get(status, TEXT_MUTED)
        conf_pct = f"{confidence * 100:.0f}%" if isinstance(confidence, float) else str(confidence)

        # Confidence history summary.
        history = raid.get("confidence_history", [])
        history_str = ""
        if history:
            deltas = [f"{e.get('delta', 0):+.0%}" for e in history[-5:]]
            history_str = f"  [{TEXT_MUTED}]Δ {' '.join(deltas)}[/]"

        retry_str = f"  [{TEXT_MUTED}]retries: {retry_count}[/]" if retry_count else ""

        yield Static(
            f"[bold {TEXT_PRIMARY}]{name}[/]  "
            f"[{TEXT_MUTED}]{raid_id}[/]  "
            f"[{color}]{status}[/]  "
            f"[{ACCENT_AMBER}]{conf_pct}[/]  "
            f"[{TEXT_SECONDARY}]session: {session_id}[/]"
            f"{retry_str}{history_str}",
            id="raid-row-content",
        )


class RaidsPage(Widget):
    """TUI page for viewing and managing raids."""

    DEFAULT_CSS = f"""
    RaidsPage {{
        width: 1fr;
        height: 1fr;
        background: {BG_SECONDARY};
    }}
    RaidsPage #raids-search {{
        margin: 0 2;
        height: 3;
    }}
    RaidsPage #raids-list {{
        height: 1fr;
    }}
    """

    class ApproveRequested(Message):
        def __init__(self, raid_id: str) -> None:
            super().__init__()
            self.raid_id = raid_id

    class RejectRequested(Message):
        def __init__(self, raid_id: str) -> None:
            super().__init__()
            self.raid_id = raid_id

    class RetryRequested(Message):
        def __init__(self, raid_id: str) -> None:
            super().__init__()
            self.raid_id = raid_id

    def __init__(
        self,
        client: CLIAPIClient | None = None,
        **kwargs: object,
    ) -> None:
        super().__init__(**kwargs)
        self._client = client
        self._raids: list[dict[str, Any]] = []
        self._filter_status: str = "All"
        self._search_query: str = ""

    @property
    def raids(self) -> list[dict[str, Any]]:
        return list(self._raids)

    @property
    def filtered_raids(self) -> list[dict[str, Any]]:
        result = self._raids
        if self._filter_status != "All":
            target = self._filter_status.upper()
            result = [r for r in result if r.get("status", "").upper() == target]
        if self._search_query:
            q = self._search_query.lower()
            result = [r for r in result if q in r.get("name", "").lower()]
        return result

    def compose(self) -> ComposeResult:
        yield NiuuTabs(items=_RAID_TABS, id="raids-tabs")
        yield MetricRow(id="raids-metrics")
        yield Input(placeholder="Search raids...", id="raids-search")
        yield VerticalScroll(id="raids-list")

    def on_mount(self) -> None:
        self._load_raids()

    def load_data(self, raids: list[dict[str, Any]]) -> None:
        """Load raid data directly (for testing or programmatic use)."""
        self._raids = raids
        self._update_metrics()
        self._render_list()

    def _load_raids(self) -> None:
        if not self._client:
            return
        try:
            resp = self._client.get("/api/v1/tyr/raids/active")
            resp.raise_for_status()
            self._raids = resp.json()
        except Exception:
            self._raids = []
        self._update_metrics()
        self._render_list()

    def _update_metrics(self) -> None:
        try:
            row = self.query_one("#raids-metrics", MetricRow)
        except Exception:
            return
        row.remove_children()

        total = len(self._raids)
        running = sum(1 for r in self._raids if r.get("status") == "RUNNING")
        review = sum(1 for r in self._raids if r.get("status") == "REVIEW")
        failed = sum(1 for r in self._raids if r.get("status") == "FAILED")

        row.mount(
            MetricCard(
                label="Total",
                value=str(total),
                icon="⚔",
                id="metric-total",
            )
        )
        row.mount(
            MetricCard(
                label="Running",
                value=str(running),
                icon="▶",
                color=ACCENT_EMERALD,
                id="metric-running",
            )
        )
        row.mount(
            MetricCard(
                label="Review",
                value=str(review),
                icon="👁",
                color=ACCENT_CYAN,
                id="metric-review",
            )
        )
        row.mount(
            MetricCard(
                label="Failed",
                value=str(failed),
                icon="✗",
                color=ACCENT_RED,
                id="metric-failed",
            )
        )

    def _render_list(self) -> None:
        try:
            container = self.query_one("#raids-list", VerticalScroll)
        except Exception:
            return
        container.remove_children()

        filtered = self.filtered_raids
        if not filtered:
            container.mount(
                Static(
                    f"[{TEXT_MUTED}]No raids found.[/]",
                )
            )
            return

        for raid in filtered:
            container.mount(RaidRow(raid))

    def on_niuu_tabs_tab_selected(self, message: NiuuTabs.TabSelected) -> None:
        self._filter_status = message.label
        self._render_list()

    def on_input_changed(self, message: Input.Changed) -> None:
        if message.input.id == "raids-search":
            self._search_query = message.value
            self._render_list()

    def approve_raid(self, raid_id: str) -> bool:
        """Approve a raid via API. Returns True on success."""
        if not self._client:
            return False
        try:
            resp = self._client.post(f"/api/v1/tyr/raids/{raid_id}/approve")
            resp.raise_for_status()
            return True
        except Exception:
            return False

    def reject_raid(self, raid_id: str) -> bool:
        """Reject a raid via API. Returns True on success."""
        if not self._client:
            return False
        try:
            resp = self._client.post(f"/api/v1/tyr/raids/{raid_id}/reject")
            resp.raise_for_status()
            return True
        except Exception:
            return False

    def retry_raid(self, raid_id: str) -> bool:
        """Retry a raid via API. Returns True on success."""
        if not self._client:
            return False
        try:
            resp = self._client.post(f"/api/v1/tyr/raids/{raid_id}/retry")
            resp.raise_for_status()
            return True
        except Exception:
            return False
