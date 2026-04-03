"""Tests for Tyr TUI pages — sagas, raids, dispatch, review."""

from __future__ import annotations

from unittest.mock import MagicMock
from uuid import uuid4

import httpx

from cli.tui.app import NiuuTUI
from cli.tui.widgets.metric_card import MetricCard
from cli.tui.widgets.tabs import NiuuTabs
from niuu.ports.plugin import TUIPageSpec
from tyr.tui.pages.dispatch import ActivityEntry, DispatchPage, QueueItem
from tyr.tui.pages.raids import RaidRow, RaidsPage
from tyr.tui.pages.review import ReviewPage, ReviewRow
from tyr.tui.pages.sagas import SagaRow, SagasPage

# ── Fixtures ─────────────────────────────────────────────────


def _saga(name: str = "test-saga", status: str = "ACTIVE", **kwargs: object) -> dict:
    return {
        "id": str(uuid4()),
        "name": name,
        "status": status,
        "raid_count": kwargs.get("raid_count", 3),
        "progress": kwargs.get("progress", "2/3"),
        "confidence": kwargs.get("confidence", 0.85),
    }


def _raid(name: str = "test-raid", status: str = "RUNNING", **kwargs: object) -> dict:
    return {
        "id": str(uuid4()),
        "name": name,
        "status": status,
        "confidence": kwargs.get("confidence", 0.75),
        "session_id": kwargs.get("session_id", "sess-001"),
        "retry_count": kwargs.get("retry_count", 0),
        "reviewer_session_id": kwargs.get("reviewer_session_id"),
        "review_round": kwargs.get("review_round", 0),
        "auto_approved": kwargs.get("auto_approved", False),
        "confidence_history": kwargs.get("confidence_history", []),
    }


SAMPLE_SAGAS = [
    _saga("auth-refactor", "ACTIVE"),
    _saga("db-migration", "COMPLETE"),
    _saga("ci-fix", "FAILED"),
]

SAMPLE_RAIDS = [
    _raid("implement-login", "RUNNING", confidence=0.9),
    _raid("add-tests", "REVIEW", confidence=0.7),
    _raid("fix-ci", "PENDING", confidence=0.5),
    _raid("update-docs", "FAILED", confidence=0.3),
    _raid("refactor-api", "ESCALATED", confidence=0.4),
]


def _mock_client(
    response_data: list | dict | None = None,
    status_code: int = 200,
) -> MagicMock:
    client = MagicMock()
    resp = MagicMock(spec=httpx.Response)
    resp.json.return_value = response_data or []
    resp.status_code = status_code
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "error", request=MagicMock(), response=resp
        )
    client.get.return_value = resp
    client.post.return_value = resp
    client.delete.return_value = resp
    return client


# ── SagaRow tests ─────────────────────────────────────────────


class TestSagaRow:
    def test_saga_property(self) -> None:
        saga = _saga("test")
        row = SagaRow(saga)
        assert row.saga["name"] == "test"

    def test_saga_row_defaults(self) -> None:
        row = SagaRow({"name": "x", "status": "ACTIVE"})
        assert row.saga["name"] == "x"

    def test_click_posts_message(self) -> None:
        saga = _saga("click-test")
        row = SagaRow(saga)
        row.post_message = MagicMock()
        row._on_click()
        row.post_message.assert_called_once()


# ── SagasPage unit tests ─────────────────────────────────────


class TestSagasPage:
    def test_filter_by_status_active(self) -> None:
        page = SagasPage()
        page._sagas = SAMPLE_SAGAS
        page._filter_status = "Active"
        assert len(page.filtered_sagas) == 1
        assert page.filtered_sagas[0]["name"] == "auth-refactor"

    def test_filter_by_status_failed(self) -> None:
        page = SagasPage()
        page._sagas = SAMPLE_SAGAS
        page._filter_status = "Failed"
        assert len(page.filtered_sagas) == 1
        assert page.filtered_sagas[0]["name"] == "ci-fix"

    def test_filter_all(self) -> None:
        page = SagasPage()
        page._sagas = SAMPLE_SAGAS
        page._filter_status = "All"
        assert len(page.filtered_sagas) == 3

    def test_search_by_name(self) -> None:
        page = SagasPage()
        page._sagas = SAMPLE_SAGAS
        page._search_query = "auth"
        assert len(page.filtered_sagas) == 1

    def test_search_empty_result(self) -> None:
        page = SagasPage()
        page._sagas = SAMPLE_SAGAS
        page._search_query = "nonexistent"
        assert len(page.filtered_sagas) == 0

    def test_combined_filter_and_search(self) -> None:
        page = SagasPage()
        page._sagas = SAMPLE_SAGAS
        page._filter_status = "Active"
        page._search_query = "auth"
        assert len(page.filtered_sagas) == 1

    def test_combined_filter_and_search_no_match(self) -> None:
        page = SagasPage()
        page._sagas = SAMPLE_SAGAS
        page._filter_status = "Failed"
        page._search_query = "auth"
        assert len(page.filtered_sagas) == 0

    def test_sagas_property(self) -> None:
        page = SagasPage()
        page._sagas = SAMPLE_SAGAS
        assert len(page.sagas) == 3

    def test_dispatch_action_with_client(self) -> None:
        client = _mock_client({"status": "dispatched"})
        page = SagasPage(client=client)
        assert page.dispatch_saga("saga-123") is True
        client.post.assert_called_once()

    def test_dispatch_action_without_client(self) -> None:
        page = SagasPage()
        assert page.dispatch_saga("saga-123") is False

    def test_delete_action_with_client(self) -> None:
        client = _mock_client()
        page = SagasPage(client=client)
        assert page.delete_saga("saga-123") is True
        client.delete.assert_called_once()

    def test_delete_action_without_client(self) -> None:
        page = SagasPage()
        assert page.delete_saga("saga-123") is False

    def test_dispatch_action_failure(self) -> None:
        client = _mock_client(status_code=500)
        page = SagasPage(client=client)
        assert page.dispatch_saga("saga-123") is False

    def test_delete_action_failure(self) -> None:
        client = _mock_client(status_code=500)
        page = SagasPage(client=client)
        assert page.delete_saga("saga-123") is False

    def test_tab_selection_updates_filter(self) -> None:
        page = SagasPage()
        page._sagas = SAMPLE_SAGAS
        page.on_niuu_tabs_tab_selected(NiuuTabs.TabSelected(1, "Active"))
        assert page._filter_status == "Active"

    def test_page_as_tui_spec(self) -> None:
        spec = TUIPageSpec(name="Sagas", icon="⚡", widget_class=SagasPage)
        assert spec.name == "Sagas"
        assert spec.widget_class is SagasPage

    def test_empty_data(self) -> None:
        page = SagasPage()
        page._sagas = []
        assert len(page.filtered_sagas) == 0

    def test_load_data_stores(self) -> None:
        """load_data stores sagas without needing a mounted widget."""
        page = SagasPage()
        page.load_data(SAMPLE_SAGAS)
        assert len(page.sagas) == 3


# ── RaidRow tests ─────────────────────────────────────────────


class TestRaidRow:
    def test_raid_property(self) -> None:
        raid = _raid("test")
        row = RaidRow(raid)
        assert row.raid["name"] == "test"

    def test_raid_defaults(self) -> None:
        row = RaidRow({"name": "x", "status": "PENDING"})
        assert row.raid["status"] == "PENDING"


# ── RaidsPage unit tests ─────────────────────────────────────


class TestRaidsPage:
    def test_filter_by_status_running(self) -> None:
        page = RaidsPage()
        page._raids = SAMPLE_RAIDS
        page._filter_status = "Running"
        assert len(page.filtered_raids) == 1

    def test_filter_by_status_review(self) -> None:
        page = RaidsPage()
        page._raids = SAMPLE_RAIDS
        page._filter_status = "Review"
        assert len(page.filtered_raids) == 1

    def test_filter_all(self) -> None:
        page = RaidsPage()
        page._raids = SAMPLE_RAIDS
        page._filter_status = "All"
        assert len(page.filtered_raids) == 5

    def test_search_raids(self) -> None:
        page = RaidsPage()
        page._raids = SAMPLE_RAIDS
        page._search_query = "login"
        assert len(page.filtered_raids) == 1

    def test_search_empty(self) -> None:
        page = RaidsPage()
        page._raids = SAMPLE_RAIDS
        page._search_query = "nonexistent"
        assert len(page.filtered_raids) == 0

    def test_combined_filter_search(self) -> None:
        page = RaidsPage()
        page._raids = SAMPLE_RAIDS
        page._filter_status = "Running"
        page._search_query = "login"
        assert len(page.filtered_raids) == 1

    def test_raids_property(self) -> None:
        page = RaidsPage()
        page._raids = SAMPLE_RAIDS
        assert len(page.raids) == 5

    def test_approve_with_client(self) -> None:
        client = _mock_client({"status": "approved"})
        page = RaidsPage(client=client)
        assert page.approve_raid("r-1") is True
        client.post.assert_called_once_with("/api/v1/tyr/raids/r-1/approve")

    def test_reject_with_client(self) -> None:
        client = _mock_client({"status": "rejected"})
        page = RaidsPage(client=client)
        assert page.reject_raid("r-1") is True
        client.post.assert_called_once_with("/api/v1/tyr/raids/r-1/reject")

    def test_retry_with_client(self) -> None:
        client = _mock_client({"status": "retrying"})
        page = RaidsPage(client=client)
        assert page.retry_raid("r-1") is True
        client.post.assert_called_once_with("/api/v1/tyr/raids/r-1/retry")

    def test_approve_without_client(self) -> None:
        page = RaidsPage()
        assert page.approve_raid("r-1") is False

    def test_reject_without_client(self) -> None:
        page = RaidsPage()
        assert page.reject_raid("r-1") is False

    def test_retry_without_client(self) -> None:
        page = RaidsPage()
        assert page.retry_raid("r-1") is False

    def test_approve_failure(self) -> None:
        client = _mock_client(status_code=500)
        page = RaidsPage(client=client)
        assert page.approve_raid("r-1") is False

    def test_reject_failure(self) -> None:
        client = _mock_client(status_code=500)
        page = RaidsPage(client=client)
        assert page.reject_raid("r-1") is False

    def test_retry_failure(self) -> None:
        client = _mock_client(status_code=500)
        page = RaidsPage(client=client)
        assert page.retry_raid("r-1") is False

    def test_tab_selection(self) -> None:
        page = RaidsPage()
        page.on_niuu_tabs_tab_selected(NiuuTabs.TabSelected(2, "Queued"))
        assert page._filter_status == "Queued"

    def test_load_data_stores(self) -> None:
        page = RaidsPage()
        page.load_data(SAMPLE_RAIDS)
        assert len(page.raids) == 5

    def test_empty_data(self) -> None:
        page = RaidsPage()
        page._raids = []
        assert len(page.filtered_raids) == 0


# ── QueueItem tests ───────────────────────────────────────────


class TestQueueItem:
    def test_properties(self) -> None:
        raid = _raid("queue-item")
        item = QueueItem(raid)
        assert item.raid["name"] == "queue-item"
        assert item.selected is False

    def test_set_selected(self) -> None:
        item = QueueItem(_raid("x"))
        item.set_selected(True)
        assert item.selected is True

    def test_click_toggles(self) -> None:
        item = QueueItem(_raid("toggle-raid"))
        assert not item.selected
        item._on_click()
        assert item.selected
        item._on_click()
        assert not item.selected

    def test_render_content_selected(self) -> None:
        item = QueueItem(_raid("sel-raid"), selected=True)
        content = item._render_content()
        assert "☑" in content

    def test_render_content_unselected(self) -> None:
        item = QueueItem(_raid("unsel-raid"), selected=False)
        content = item._render_content()
        assert "☐" in content


# ── ActivityEntry tests ───────────────────────────────────────


class TestActivityEntry:
    def test_init(self) -> None:
        entry = ActivityEntry(
            {
                "action": "dispatch",
                "name": "test-saga",
                "timestamp": "12:00",
                "status": "success",
            }
        )
        assert entry._entry["action"] == "dispatch"


# ── DispatchPage unit tests ───────────────────────────────────


class TestDispatchPage:
    def test_pending_raids_property(self) -> None:
        page = DispatchPage()
        pending = [_raid("p1", "PENDING"), _raid("p2", "PENDING")]
        page._pending_raids = pending
        assert len(page.pending_raids) == 2

    def test_activity_log_property(self) -> None:
        page = DispatchPage()
        activity = [{"action": "dispatch", "name": "s1"}]
        page._activity_log = activity
        assert len(page.activity_log) == 1

    def test_default_config(self) -> None:
        page = DispatchPage()
        assert page.dispatch_config["max_concurrent"] == 3
        assert page.dispatch_config["threshold"] == 0.7

    def test_toggle_selection(self) -> None:
        page = DispatchPage()
        page.toggle_selection("raid-1")
        assert "raid-1" in page.selected_ids
        page.toggle_selection("raid-1")
        assert "raid-1" not in page.selected_ids

    def test_toggle_selection_multiple(self) -> None:
        page = DispatchPage()
        page.toggle_selection("r1")
        page.toggle_selection("r2")
        assert len(page.selected_ids) == 2

    def test_select_all(self) -> None:
        pending = [_raid("p1", "PENDING"), _raid("p2", "PENDING")]
        page = DispatchPage()
        page._pending_raids = pending
        page.select_all()
        assert len(page.selected_ids) == 2

    def test_clear_selection(self) -> None:
        page = DispatchPage()
        page._selected_ids = {"r1", "r2"}
        page.clear_selection()
        assert len(page.selected_ids) == 0

    def test_dispatch_selected_with_client(self) -> None:
        client = _mock_client({"status": "dispatched"})
        page = DispatchPage(client=client)
        page._selected_ids = {"raid-1", "raid-2"}
        result = page.dispatch_selected()
        assert len(result) == 2
        assert client.post.call_count == 2

    def test_dispatch_selected_without_client(self) -> None:
        page = DispatchPage()
        page._selected_ids = {"raid-1"}
        result = page.dispatch_selected()
        assert result == []

    def test_dispatch_selected_clears_successes(self) -> None:
        client = _mock_client({"status": "dispatched"})
        page = DispatchPage(client=client)
        page._selected_ids = {"r1", "r2"}
        page.dispatch_selected()
        assert len(page._selected_ids) == 0

    def test_tab_selection(self) -> None:
        page = DispatchPage()
        page.on_niuu_tabs_tab_selected(NiuuTabs.TabSelected(1, "Activity"))
        assert page._active_tab == "Activity"

    def test_load_data_pending(self) -> None:
        page = DispatchPage()
        pending = [_raid("p1", "PENDING")]
        page.load_data(pending=pending)
        assert len(page.pending_raids) == 1

    def test_load_data_activity(self) -> None:
        page = DispatchPage()
        activity = [{"action": "dispatch", "name": "s1"}]
        page.load_data(activity=activity)
        assert len(page.activity_log) == 1

    def test_load_data_config(self) -> None:
        page = DispatchPage()
        page.load_data(config={"max_concurrent": 5, "threshold": 0.8})
        assert page.dispatch_config["max_concurrent"] == 5
        assert page.dispatch_config["threshold"] == 0.8

    def test_empty_queue(self) -> None:
        page = DispatchPage()
        page._pending_raids = []
        assert len(page.pending_raids) == 0

    def test_render_config(self) -> None:
        page = DispatchPage()
        rendered = page._render_config()
        assert "max concurrent" in rendered
        assert "threshold" in rendered


# ── ReviewRow tests ───────────────────────────────────────────


class TestReviewRow:
    def test_raid_property(self) -> None:
        raid = _raid("review-raid", "REVIEW")
        row = ReviewRow(raid)
        assert row.raid["name"] == "review-raid"

    def test_high_confidence(self) -> None:
        raid = _raid("hi", "REVIEW", confidence=0.9)
        row = ReviewRow(raid)
        assert row.raid["confidence"] == 0.9

    def test_low_confidence(self) -> None:
        raid = _raid("lo", "REVIEW", confidence=0.3)
        row = ReviewRow(raid)
        assert row.raid["confidence"] == 0.3


# ── ReviewPage unit tests ─────────────────────────────────────


class TestReviewPage:
    def test_filter_in_review(self) -> None:
        raids = [
            _raid("r1", "REVIEW"),
            _raid("r2", "ESCALATED"),
            _raid("r3", "REVIEW", auto_approved=True),
        ]
        page = ReviewPage()
        page._raids = raids
        page._filter_tab = "In Review"
        assert len(page.filtered_raids) == 1
        assert page.filtered_raids[0]["name"] == "r1"

    def test_filter_auto_approved(self) -> None:
        raids = [
            _raid("r1", "REVIEW"),
            _raid("r2", "REVIEW", auto_approved=True),
        ]
        page = ReviewPage()
        page._raids = raids
        page._filter_tab = "Auto-approved"
        assert len(page.filtered_raids) == 1
        assert page.filtered_raids[0]["name"] == "r2"

    def test_filter_escalated(self) -> None:
        raids = [
            _raid("r1", "REVIEW"),
            _raid("r2", "ESCALATED"),
        ]
        page = ReviewPage()
        page._raids = raids
        page._filter_tab = "Escalated"
        assert len(page.filtered_raids) == 1
        assert page.filtered_raids[0]["name"] == "r2"

    def test_filter_all(self) -> None:
        raids = [_raid("r1", "REVIEW"), _raid("r2", "ESCALATED")]
        page = ReviewPage()
        page._raids = raids
        page._filter_tab = "All"
        assert len(page.filtered_raids) == 2

    def test_raids_property(self) -> None:
        page = ReviewPage()
        raids = [_raid("r1", "REVIEW")]
        page._raids = raids
        assert len(page.raids) == 1

    def test_tab_selection(self) -> None:
        page = ReviewPage()
        page.on_niuu_tabs_tab_selected(NiuuTabs.TabSelected(1, "In Review"))
        assert page._filter_tab == "In Review"

    def test_load_data_stores(self) -> None:
        page = ReviewPage()
        raids = [_raid("r1", "REVIEW"), _raid("r2", "ESCALATED")]
        page.load_data(raids)
        assert len(page.raids) == 2

    def test_empty_data(self) -> None:
        page = ReviewPage()
        page._raids = []
        assert len(page.filtered_raids) == 0

    def test_confidence_history(self) -> None:
        raids = [
            _raid(
                "hist-raid",
                "REVIEW",
                confidence_history=[
                    {"delta": 0.1, "score_after": 0.8},
                    {"delta": -0.05, "score_after": 0.75},
                ],
            ),
        ]
        page = ReviewPage()
        page._raids = raids
        assert len(page.filtered_raids) == 1


# ── TyrPlugin.tui_pages() tests ──────────────────────────────


class TestTyrPluginTUIPages:
    def test_tui_pages_returns_specs(self) -> None:
        from tyr.plugin import TyrPlugin

        plugin = TyrPlugin()
        pages = plugin.tui_pages()
        assert len(pages) == 4
        names = [p.name for p in pages]
        assert "Sagas" in names
        assert "Raids" in names
        assert "Dispatch" in names
        assert "Review" in names

    def test_tui_pages_have_icons(self) -> None:
        from tyr.plugin import TyrPlugin

        plugin = TyrPlugin()
        pages = plugin.tui_pages()
        for page in pages:
            assert page.icon

    def test_tui_pages_widget_classes(self) -> None:
        from tyr.plugin import TyrPlugin

        plugin = TyrPlugin()
        pages = plugin.tui_pages()
        widget_classes = {p.widget_class for p in pages}
        assert SagasPage in widget_classes
        assert RaidsPage in widget_classes
        assert DispatchPage in widget_classes
        assert ReviewPage in widget_classes

    def test_tui_pages_are_tuipagespecs(self) -> None:
        from tyr.plugin import TyrPlugin

        plugin = TyrPlugin()
        pages = plugin.tui_pages()
        for page in pages:
            assert isinstance(page, TUIPageSpec)


# ── Textual integration tests (minimal) ──────────────────────


class TestTUIIntegration:
    """Minimal Textual app tests — one per page to verify mounting."""

    async def test_sagas_page_mounts(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = SagasPage()
            app.mount(page)
            await pilot.pause()
            assert page.query_one("#sagas-tabs", NiuuTabs) is not None

    async def test_raids_page_mounts(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = RaidsPage()
            app.mount(page)
            await pilot.pause()
            assert page.query_one("#raids-tabs", NiuuTabs) is not None

    async def test_dispatch_page_mounts(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = DispatchPage()
            app.mount(page)
            await pilot.pause()
            assert page.query_one("#dispatch-tabs", NiuuTabs) is not None

    async def test_review_page_mounts(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = ReviewPage()
            app.mount(page)
            await pilot.pause()
            assert page.query_one("#review-tabs", NiuuTabs) is not None

    async def test_sagas_load_data_renders(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = SagasPage()
            app.mount(page)
            await pilot.pause()
            page.load_data(SAMPLE_SAGAS)
            await pilot.pause()
            total = page.query_one("#metric-total", MetricCard)
            assert total.value == "3"

    async def test_raids_load_data_renders(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = RaidsPage()
            app.mount(page)
            await pilot.pause()
            page.load_data(SAMPLE_RAIDS)
            await pilot.pause()
            total = page.query_one("#metric-total", MetricCard)
            assert total.value == "5"

    async def test_sagas_from_api(self) -> None:
        client = _mock_client(SAMPLE_SAGAS)
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = SagasPage(client=client)
            app.mount(page)
            await pilot.pause()
            assert len(page.sagas) == 3

    async def test_raids_from_api(self) -> None:
        client = _mock_client(SAMPLE_RAIDS)
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = RaidsPage(client=client)
            app.mount(page)
            await pilot.pause()
            assert len(page.raids) == 5

    async def test_dispatch_load_data_renders(self) -> None:
        pending = [_raid("p1", "PENDING"), _raid("p2", "PENDING")]
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = DispatchPage()
            app.mount(page)
            await pilot.pause()
            page.load_data(pending=pending)
            await pilot.pause()
            queued = page.query_one("#metric-queued", MetricCard)
            assert queued.value == "2"

    async def test_dispatch_from_api(self) -> None:
        raids = [_raid("p1", "PENDING"), _raid("r1", "RUNNING")]
        client = _mock_client(raids)
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = DispatchPage(client=client)
            app.mount(page)
            await pilot.pause()
            assert len(page.pending_raids) == 1

    async def test_review_load_data_renders(self) -> None:
        raids = [
            _raid("r1", "REVIEW"),
            _raid("r2", "ESCALATED"),
            _raid("r3", "REVIEW", auto_approved=True),
        ]
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = ReviewPage()
            app.mount(page)
            await pilot.pause()
            page.load_data(raids)
            await pilot.pause()
            total = page.query_one("#metric-total", MetricCard)
            assert total.value == "3"

    async def test_review_from_api(self) -> None:
        all_raids = [
            _raid("r1", "REVIEW"),
            _raid("r2", "RUNNING"),
            _raid("r3", "ESCALATED"),
        ]
        client = _mock_client(all_raids)
        app = NiuuTUI()
        async with app.run_test() as pilot:
            page = ReviewPage(client=client)
            app.mount(page)
            await pilot.pause()
            assert len(page.raids) == 2

    async def test_saga_row_renders_in_app(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            row = SagaRow(_saga("my-saga", "ACTIVE", confidence=0.9))
            app.mount(row)
            await pilot.pause()
            content = row.query_one("#saga-row-content")
            assert content is not None

    async def test_raid_row_renders_in_app(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            row = RaidRow(_raid("my-raid", "RUNNING"))
            app.mount(row)
            await pilot.pause()
            content = row.query_one("#raid-row-content")
            assert content is not None

    async def test_review_row_renders_in_app(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            row = ReviewRow(_raid("rv-raid", "REVIEW", confidence=0.85, auto_approved=True))
            app.mount(row)
            await pilot.pause()
            content = row.query_one("#review-row-content")
            assert content is not None

    async def test_queue_item_renders_in_app(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            item = QueueItem(_raid("q-raid", "PENDING"), selected=True)
            app.mount(item)
            await pilot.pause()
            content = item.query_one("#queue-item-content")
            assert content is not None

    async def test_activity_entry_renders_in_app(self) -> None:
        app = NiuuTUI()
        async with app.run_test() as pilot:
            entry = ActivityEntry(
                {
                    "action": "dispatch",
                    "name": "test",
                    "timestamp": "12:00",
                    "status": "success",
                }
            )
            app.mount(entry)
            await pilot.pause()
            assert entry is not None
