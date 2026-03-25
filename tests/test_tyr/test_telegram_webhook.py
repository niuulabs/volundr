"""Tests for Telegram webhook command interface."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tyr.adapters.inbound.rest_telegram_webhook import (
    HELP_TEXT,
    ParsedCommand,
    _dispatch_command,
    _find_raid_by_tracker_id,
    create_telegram_webhook_router,
    parse_command,
    send_telegram_reply,
)
from tyr.config import TelegramConfig
from tyr.domain.models import (
    DispatcherState,
    Raid,
    RaidStatus,
    Saga,
    SagaStatus,
)
from tyr.ports.dispatcher_repository import DispatcherRepository
from tyr.ports.notification_subscriptions import NotificationSubscriptionRepository
from tyr.ports.raid_repository import RaidRepository
from tyr.ports.saga_repository import SagaRepository
from tyr.ports.volundr import VolundrPort, VolundrSession

# ---------------------------------------------------------------------------
# Mock implementations
# ---------------------------------------------------------------------------


class StubNotificationSubRepo(NotificationSubscriptionRepository):
    """In-memory notification subscription repo for tests."""

    def __init__(self, mapping: dict[str, str] | None = None) -> None:
        # chat_id -> owner_id
        self._mapping = mapping or {}

    async def find_owner_by_telegram_chat_id(self, chat_id: str) -> str | None:
        return self._mapping.get(chat_id)


class StubSagaRepo(SagaRepository):
    def __init__(self, sagas: list[Saga] | None = None) -> None:
        self._sagas = sagas or []

    async def save_saga(self, saga: Saga) -> None:
        pass

    async def list_sagas(self, *, owner_id: str | None = None) -> list[Saga]:
        if owner_id is None:
            return self._sagas
        return [s for s in self._sagas if s.owner_id == owner_id]

    async def get_saga(self, saga_id: UUID, *, owner_id: str | None = None) -> Saga | None:
        return next((s for s in self._sagas if s.id == saga_id), None)

    async def delete_saga(self, saga_id: UUID, *, owner_id: str | None = None) -> bool:
        return False


class StubRaidRepo(RaidRepository):
    def __init__(self) -> None:
        self.raids: dict[UUID, Raid] = {}
        self._tracker_id_map: dict[str, Raid] = {}

    def add_raid(self, raid: Raid) -> None:
        self.raids[raid.id] = raid
        self._tracker_id_map[raid.tracker_id] = raid

    async def get_raid(self, raid_id: UUID) -> Raid | None:
        return self.raids.get(raid_id)

    async def update_raid_status(
        self,
        raid_id: UUID,
        status: RaidStatus,
        *,
        reason: str | None = None,
        increment_retry: bool = False,
    ) -> Raid | None:
        raid = self.raids.get(raid_id)
        if raid is None:
            return None
        updated = Raid(
            id=raid.id,
            phase_id=raid.phase_id,
            tracker_id=raid.tracker_id,
            name=raid.name,
            description=raid.description,
            acceptance_criteria=raid.acceptance_criteria,
            declared_files=raid.declared_files,
            estimate_hours=raid.estimate_hours,
            status=status,
            confidence=raid.confidence,
            session_id=raid.session_id,
            branch=raid.branch,
            chronicle_summary=raid.chronicle_summary,
            retry_count=raid.retry_count + (1 if increment_retry else 0),
            created_at=raid.created_at,
            updated_at=datetime.now(UTC),
        )
        self.raids[raid_id] = updated
        self._tracker_id_map[raid.tracker_id] = updated
        return updated

    async def get_confidence_events(self, raid_id: UUID) -> list:
        return []

    async def add_confidence_event(self, event) -> None:
        pass

    async def get_saga_for_raid(self, raid_id: UUID) -> Saga | None:
        return None

    async def get_phase_for_raid(self, raid_id: UUID) -> None:
        return None

    async def all_raids_merged(self, phase_id: UUID) -> bool:
        return False

    async def find_raid_by_tracker_id(self, tracker_id: str) -> Raid | None:
        return self._tracker_id_map.get(tracker_id)


class StubDispatcherRepo(DispatcherRepository):
    def __init__(self, running: bool = True) -> None:
        self._state = DispatcherState(
            id=uuid4(),
            owner_id="user-1",
            running=running,
            threshold=0.7,
            max_concurrent_raids=3,
            updated_at=datetime.now(UTC),
        )

    async def get_or_create(self, owner_id: str) -> DispatcherState:
        return self._state

    async def update(self, owner_id: str, **fields: object) -> DispatcherState:
        running = fields.get("running", self._state.running)
        self._state = DispatcherState(
            id=self._state.id,
            owner_id=owner_id,
            running=running,
            threshold=self._state.threshold,
            max_concurrent_raids=self._state.max_concurrent_raids,
            updated_at=datetime.now(UTC),
        )
        return self._state


class StubVolundr(VolundrPort):
    def __init__(self, sessions: list[VolundrSession] | None = None) -> None:
        self._sessions = sessions or []
        self.sent_messages: list[tuple[str, str]] = []

    async def spawn_session(self, request, *, auth_token=None):
        raise NotImplementedError

    async def get_session(self, session_id, *, auth_token=None):
        return next((s for s in self._sessions if s.id == session_id), None)

    async def list_sessions(self, *, auth_token=None):
        return self._sessions

    async def get_pr_status(self, session_id):
        raise NotImplementedError

    async def get_chronicle_summary(self, session_id):
        return ""

    async def send_message(self, session_id, message, *, auth_token=None):
        self.sent_messages.append((session_id, message))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

OWNER_ID = "user-1"
CHAT_ID = "123456"
BOT_TOKEN = "test-bot-token"


def _make_raid(
    raid_id: UUID | None = None,
    tracker_id: str = "NIU-221",
    status: RaidStatus = RaidStatus.REVIEW,
) -> Raid:
    now = datetime.now(UTC)
    return Raid(
        id=raid_id or uuid4(),
        phase_id=uuid4(),
        tracker_id=tracker_id,
        name="Test raid",
        description="A test raid",
        acceptance_criteria=["it works"],
        declared_files=["src/main.py"],
        estimate_hours=2.0,
        status=status,
        confidence=0.55,
        session_id="session-1",
        branch="raid/test",
        chronicle_summary="summary",
        retry_count=0,
        created_at=now,
        updated_at=now,
    )


def _make_saga(owner_id: str = OWNER_ID) -> Saga:
    return Saga(
        id=uuid4(),
        tracker_id="proj-1",
        tracker_type="mock",
        slug="alpha",
        name="Alpha",
        repos=["org/repo"],
        feature_branch="feat/alpha",
        status=SagaStatus.ACTIVE,
        confidence=0.0,
        created_at=datetime.now(UTC),
        owner_id=owner_id,
    )


def _make_update(text: str, chat_id: str = CHAT_ID) -> dict:
    """Build a minimal Telegram Update payload."""
    return {
        "update_id": 1,
        "message": {
            "message_id": 1,
            "from": {"id": int(chat_id), "first_name": "Test"},
            "chat": {"id": int(chat_id), "type": "private"},
            "text": text,
        },
    }


@pytest.fixture
def sub_repo() -> StubNotificationSubRepo:
    return StubNotificationSubRepo({CHAT_ID: OWNER_ID})


@pytest.fixture
def raid_repo() -> StubRaidRepo:
    return StubRaidRepo()


@pytest.fixture
def saga_repo() -> StubSagaRepo:
    return StubSagaRepo([_make_saga()])


@pytest.fixture
def dispatcher_repo() -> StubDispatcherRepo:
    return StubDispatcherRepo()


@pytest.fixture
def volundr() -> StubVolundr:
    return StubVolundr(
        [
            VolundrSession(
                id="sess-1",
                name="Alpha raid 1",
                status="running",
                tracker_issue_id="NIU-221",
            ),
        ]
    )


@pytest.fixture
def client(
    sub_repo: StubNotificationSubRepo,
    raid_repo: StubRaidRepo,
    saga_repo: StubSagaRepo,
    dispatcher_repo: StubDispatcherRepo,
    volundr: StubVolundr,
) -> TestClient:
    app = FastAPI()
    app.include_router(create_telegram_webhook_router())

    app.state.notification_sub_repo = sub_repo
    app.state.raid_repo = raid_repo
    app.state.saga_repo = saga_repo
    app.state.dispatcher_repo = dispatcher_repo
    app.state.volundr = volundr
    app.state.settings = SimpleNamespace(
        telegram=TelegramConfig(bot_token=BOT_TOKEN),
    )

    return TestClient(app)


# ---------------------------------------------------------------------------
# parse_command tests
# ---------------------------------------------------------------------------


class TestParseCommand:
    def test_basic_command(self):
        cmd = parse_command("/status")
        assert cmd is not None
        assert cmd.name == "status"
        assert cmd.args == []

    def test_command_with_args(self):
        cmd = parse_command("/approve NIU-221")
        assert cmd is not None
        assert cmd.name == "approve"
        assert cmd.args == ["NIU-221"]

    def test_command_with_multiple_args(self):
        cmd = parse_command("/reject NIU-221 scope drift detected")
        assert cmd is not None
        assert cmd.name == "reject"
        assert cmd.args == ["NIU-221", "scope", "drift", "detected"]
        assert cmd.raw_text == "NIU-221 scope drift detected"

    def test_command_with_bot_mention(self):
        cmd = parse_command("/status@TyrBot")
        assert cmd is not None
        assert cmd.name == "status"

    def test_non_command_returns_none(self):
        assert parse_command("hello world") is None

    def test_empty_string_returns_none(self):
        assert parse_command("") is None

    def test_whitespace_only_returns_none(self):
        assert parse_command("   ") is None

    def test_command_case_insensitive(self):
        cmd = parse_command("/STATUS")
        assert cmd is not None
        assert cmd.name == "status"

    def test_command_with_leading_whitespace(self):
        cmd = parse_command("  /help")
        assert cmd is not None
        assert cmd.name == "help"


# ---------------------------------------------------------------------------
# Webhook endpoint tests
# ---------------------------------------------------------------------------


class TestWebhookEndpoint:
    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_unauthenticated_chat(self, mock_reply, client: TestClient):
        """Unlinked chat_id gets a 'not configured' message."""
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/status", chat_id="999999"),
        )
        assert resp.status_code == 200
        mock_reply.assert_called_once()
        reply_text = mock_reply.call_args[0][2]
        assert "not linked" in reply_text.lower()

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_no_message_in_update(self, mock_reply, client: TestClient):
        """Updates without a message field are ignored."""
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json={"update_id": 1},
        )
        assert resp.status_code == 200
        mock_reply.assert_not_called()

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_empty_text_ignored(self, mock_reply, client: TestClient):
        """Messages with empty text are ignored."""
        update = _make_update("")
        resp = client.post("/api/v1/tyr/telegram/webhook", json=update)
        assert resp.status_code == 200
        mock_reply.assert_not_called()

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_non_command_text_ignored(self, mock_reply, client: TestClient):
        """Regular text (no /) is ignored after auth but before command dispatch."""
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("hello there"),
        )
        assert resp.status_code == 200
        mock_reply.assert_not_called()

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_unknown_command_returns_help(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/foobar"),
        )
        assert resp.status_code == 200
        mock_reply.assert_called_once()
        reply_text = mock_reply.call_args[0][2]
        assert "Unknown command" in reply_text
        assert "/foobar" in reply_text

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_help_command(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/help"),
        )
        assert resp.status_code == 200
        mock_reply.assert_called_once()
        reply_text = mock_reply.call_args[0][2]
        assert reply_text == HELP_TEXT

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_start_command_returns_help(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/start"),
        )
        assert resp.status_code == 200
        reply_text = mock_reply.call_args[0][2]
        assert reply_text == HELP_TEXT


# ---------------------------------------------------------------------------
# /status command
# ---------------------------------------------------------------------------


class TestStatusCommand:
    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_status_shows_overview(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/status"),
        )
        assert resp.status_code == 200
        reply = mock_reply.call_args[0][2]
        assert "Dispatcher: running" in reply
        assert "Active sagas: 1" in reply
        assert "Alpha" in reply
        assert "Running sessions: 1" in reply


# ---------------------------------------------------------------------------
# /approve command
# ---------------------------------------------------------------------------


class TestApproveCommand:
    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_approve_success(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid()
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/approve NIU-221"),
        )
        assert resp.status_code == 200
        reply = mock_reply.call_args[0][2]
        assert "approved" in reply.lower()
        assert "MERGED" in reply
        assert raid_repo.raids[raid.id].status == RaidStatus.MERGED

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_approve_no_args(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/approve"),
        )
        assert resp.status_code == 200
        assert "Usage" in mock_reply.call_args[0][2]

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_approve_not_found(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/approve MISSING-1"),
        )
        assert resp.status_code == 200
        assert "not found" in mock_reply.call_args[0][2].lower()

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_approve_wrong_state(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid(status=RaidStatus.PENDING)
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/approve NIU-221"),
        )
        assert resp.status_code == 200
        assert "PENDING" in mock_reply.call_args[0][2]

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_approve_by_uuid(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid()
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update(f"/approve {raid.id}"),
        )
        assert resp.status_code == 200
        reply = mock_reply.call_args[0][2]
        assert "approved" in reply.lower()


# ---------------------------------------------------------------------------
# /reject command
# ---------------------------------------------------------------------------


class TestRejectCommand:
    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_reject_success(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid()
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/reject NIU-221 scope drift"),
        )
        assert resp.status_code == 200
        reply = mock_reply.call_args[0][2]
        assert "rejected" in reply.lower()
        assert "FAILED" in reply
        assert "scope drift" in reply
        assert raid_repo.raids[raid.id].status == RaidStatus.FAILED

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_reject_no_reason(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid()
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/reject NIU-221"),
        )
        assert resp.status_code == 200
        reply = mock_reply.call_args[0][2]
        assert "rejected" in reply.lower()
        assert "reason" not in reply.lower()

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_reject_no_args(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/reject"),
        )
        assert resp.status_code == 200
        assert "Usage" in mock_reply.call_args[0][2]

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_reject_wrong_state(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid(status=RaidStatus.MERGED)
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/reject NIU-221"),
        )
        assert resp.status_code == 200
        assert "MERGED" in mock_reply.call_args[0][2]


# ---------------------------------------------------------------------------
# /retry command
# ---------------------------------------------------------------------------


class TestRetryCommand:
    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_retry_from_review(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid(status=RaidStatus.REVIEW)
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/retry NIU-221"),
        )
        assert resp.status_code == 200
        reply = mock_reply.call_args[0][2]
        assert "retry" in reply.lower()
        assert "PENDING" in reply
        assert raid_repo.raids[raid.id].status == RaidStatus.PENDING
        assert raid_repo.raids[raid.id].retry_count == 1

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_retry_from_failed(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid(status=RaidStatus.FAILED)
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/retry NIU-221"),
        )
        assert resp.status_code == 200
        assert "PENDING" in mock_reply.call_args[0][2]

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_retry_wrong_state(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid(status=RaidStatus.RUNNING)
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/retry NIU-221"),
        )
        assert resp.status_code == 200
        assert "RUNNING" in mock_reply.call_args[0][2]

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_retry_no_args(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/retry"),
        )
        assert resp.status_code == 200
        assert "Usage" in mock_reply.call_args[0][2]


# ---------------------------------------------------------------------------
# /pause and /resume commands
# ---------------------------------------------------------------------------


class TestPauseResumeCommands:
    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_pause_running_dispatcher(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/pause"),
        )
        assert resp.status_code == 200
        assert "paused" in mock_reply.call_args[0][2].lower()

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_pause_already_paused(
        self, mock_reply, client: TestClient, dispatcher_repo: StubDispatcherRepo
    ):
        dispatcher_repo._state = DispatcherState(
            id=uuid4(),
            owner_id=OWNER_ID,
            running=False,
            threshold=0.7,
            max_concurrent_raids=3,
            updated_at=datetime.now(UTC),
        )
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/pause"),
        )
        assert resp.status_code == 200
        assert "already paused" in mock_reply.call_args[0][2].lower()

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_resume_paused_dispatcher(
        self, mock_reply, client: TestClient, dispatcher_repo: StubDispatcherRepo
    ):
        dispatcher_repo._state = DispatcherState(
            id=uuid4(),
            owner_id=OWNER_ID,
            running=False,
            threshold=0.7,
            max_concurrent_raids=3,
            updated_at=datetime.now(UTC),
        )
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/resume"),
        )
        assert resp.status_code == 200
        assert "resumed" in mock_reply.call_args[0][2].lower()

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_resume_already_running(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/resume"),
        )
        assert resp.status_code == 200
        assert "already running" in mock_reply.call_args[0][2].lower()


# ---------------------------------------------------------------------------
# /dispatch command
# ---------------------------------------------------------------------------


class TestDispatchCommand:
    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_dispatch_pending_raid(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid(status=RaidStatus.PENDING)
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/dispatch NIU-221"),
        )
        assert resp.status_code == 200
        reply = mock_reply.call_args[0][2]
        assert "queued" in reply.lower()
        assert "QUEUED" in reply
        assert raid_repo.raids[raid.id].status == RaidStatus.QUEUED

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_dispatch_wrong_state(self, mock_reply, client: TestClient, raid_repo: StubRaidRepo):
        raid = _make_raid(status=RaidStatus.RUNNING)
        raid_repo.add_raid(raid)

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/dispatch NIU-221"),
        )
        assert resp.status_code == 200
        assert "RUNNING" in mock_reply.call_args[0][2]

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_dispatch_no_args(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/dispatch"),
        )
        assert resp.status_code == 200
        assert "Usage" in mock_reply.call_args[0][2]


# ---------------------------------------------------------------------------
# /sessions command
# ---------------------------------------------------------------------------


class TestSessionsCommand:
    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_sessions_lists_running(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/sessions"),
        )
        assert resp.status_code == 200
        reply = mock_reply.call_args[0][2]
        assert "sess-1" in reply
        assert "Alpha raid 1" in reply

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_sessions_empty(self, mock_reply, client: TestClient, volundr: StubVolundr):
        volundr._sessions = []
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/sessions"),
        )
        assert resp.status_code == 200
        assert "No running sessions" in mock_reply.call_args[0][2]


# ---------------------------------------------------------------------------
# /say command
# ---------------------------------------------------------------------------


class TestSayCommand:
    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_say_sends_message(self, mock_reply, client: TestClient, volundr: StubVolundr):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/say sess-1 fix the failing test"),
        )
        assert resp.status_code == 200
        reply = mock_reply.call_args[0][2]
        assert "Message sent" in reply
        assert volundr.sent_messages == [("sess-1", "fix the failing test")]

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_say_session_not_found(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/say nonexistent hello"),
        )
        assert resp.status_code == 200
        assert "not found" in mock_reply.call_args[0][2].lower()

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_say_no_args(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/say"),
        )
        assert resp.status_code == 200
        assert "Usage" in mock_reply.call_args[0][2]

    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_say_missing_message(self, mock_reply, client: TestClient):
        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/say sess-1"),
        )
        assert resp.status_code == 200
        assert "Usage" in mock_reply.call_args[0][2]


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestErrorHandling:
    @patch("tyr.adapters.inbound.rest_telegram_webhook.send_telegram_reply", new_callable=AsyncMock)
    def test_command_handler_exception(self, mock_reply, client: TestClient):
        """If a command handler throws, we reply with an error message."""
        # Break the saga_repo to force an exception in /status
        client.app.state.saga_repo = None

        resp = client.post(
            "/api/v1/tyr/telegram/webhook",
            json=_make_update("/status"),
        )
        assert resp.status_code == 200
        reply = mock_reply.call_args[0][2]
        assert "Error" in reply


# ---------------------------------------------------------------------------
# send_telegram_reply unit tests
# ---------------------------------------------------------------------------


class TestSendTelegramReply:
    @pytest.mark.asyncio
    async def test_no_token_logs_warning(self):
        """When bot_token is empty, no HTTP call is made."""
        # Should not raise — just logs a warning
        await send_telegram_reply("", "12345", "hello")

    @pytest.mark.asyncio
    async def test_http_error_suppressed(self):
        """Network errors during reply do not propagate."""
        with patch("tyr.adapters.inbound.rest_telegram_webhook.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            import httpx as _httpx

            mock_client.post.side_effect = _httpx.ConnectError("fail")
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_cls.return_value = mock_client

            # Should not raise
            await send_telegram_reply("token", "12345", "hello")


# ---------------------------------------------------------------------------
# _find_raid_by_tracker_id unit tests
# ---------------------------------------------------------------------------


class TestFindRaidByTrackerId:
    @pytest.mark.asyncio
    async def test_uuid_lookup(self):
        repo = StubRaidRepo()
        raid = _make_raid()
        repo.add_raid(raid)

        found = await _find_raid_by_tracker_id(repo, str(raid.id), OWNER_ID)
        assert found is not None
        assert found.id == raid.id

    @pytest.mark.asyncio
    async def test_tracker_id_lookup(self):
        repo = StubRaidRepo()
        raid = _make_raid(tracker_id="NIU-300")
        repo.add_raid(raid)

        found = await _find_raid_by_tracker_id(repo, "NIU-300", OWNER_ID)
        assert found is not None
        assert found.tracker_id == "NIU-300"

    @pytest.mark.asyncio
    async def test_not_found(self):
        repo = StubRaidRepo()
        found = await _find_raid_by_tracker_id(repo, "MISSING-1", OWNER_ID)
        assert found is None


# ---------------------------------------------------------------------------
# _dispatch_command unit tests
# ---------------------------------------------------------------------------


class TestDispatchCommandFunction:
    @pytest.mark.asyncio
    async def test_unknown_command(self):
        result = await _dispatch_command(
            OWNER_ID,
            ParsedCommand(name="xyz", args=[], raw_text=""),
            raid_repo=StubRaidRepo(),
            saga_repo=StubSagaRepo(),
            volundr=StubVolundr(),
            dispatcher_repo=StubDispatcherRepo(),
        )
        assert "Unknown command" in result
        assert "/xyz" in result
