"""Tests for the notification service, channel factory, and Telegram adapter."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import UUID, uuid4

import httpx
import pytest

from niuu.domain.models import IntegrationConnection, IntegrationType
from tyr.adapters.notification_channel_factory import NotificationChannelFactory
from tyr.adapters.telegram_notification import TelegramNotificationAdapter
from tyr.domain.models import Phase, Raid, RaidStatus, Saga, SagaStatus
from tyr.domain.services.notification import NotificationService
from tyr.events import EventBus, TyrEvent
from tyr.ports.notification_channel import (
    Notification,
    NotificationChannel,
    NotificationUrgency,
)
from tyr.ports.raid_repository import RaidRepository

from .conftest import StubCredentialStore, StubIntegrationRepo

# ---------------------------------------------------------------------------
# Fixtures / Stubs
# ---------------------------------------------------------------------------

NOW = datetime.now(UTC)


class RecordingChannel(NotificationChannel):
    """In-memory channel that records sent notifications."""

    def __init__(self, *, min_urgency: NotificationUrgency = NotificationUrgency.LOW) -> None:
        self.sent: list[Notification] = []
        self._min_urgency = min_urgency
        self._urgency_rank = {
            NotificationUrgency.LOW: 0,
            NotificationUrgency.MEDIUM: 1,
            NotificationUrgency.HIGH: 2,
        }

    def should_notify(self, notification: Notification) -> bool:
        return (
            self._urgency_rank.get(notification.urgency, 0) >= self._urgency_rank[self._min_urgency]
        )

    async def send(self, notification: Notification) -> None:
        self.sent.append(notification)


class FailingChannel(NotificationChannel):
    """Channel that always raises on send."""

    def should_notify(self, notification: Notification) -> bool:
        return True

    async def send(self, notification: Notification) -> None:
        raise RuntimeError("Channel failed")


class StubRaidRepo(RaidRepository):
    """In-memory raid repository for notification tests."""

    def __init__(self) -> None:
        self.raids: dict[UUID, Raid] = {}
        self.saga: Saga | None = None

    async def get_raid(self, raid_id: UUID) -> Raid | None:
        return self.raids.get(raid_id)

    async def update_raid_status(
        self, raid_id: UUID, status: RaidStatus, **kwargs: object
    ) -> Raid | None:
        raise NotImplementedError

    async def list_by_status(self, status: RaidStatus) -> list[Raid]:
        return [r for r in self.raids.values() if r.status == status]

    async def update_raid_completion(self, raid_id: UUID, **kwargs: object) -> Raid | None:
        raise NotImplementedError

    async def get_confidence_events(self, raid_id: UUID) -> list:
        return []

    async def add_confidence_event(self, event: object) -> None:
        pass

    async def find_raid_by_tracker_id(self, tracker_id: str) -> Raid | None:
        for raid in self.raids.values():
            if raid.tracker_id == tracker_id:
                return raid
        return None

    async def get_saga_for_raid(self, raid_id: UUID) -> Saga | None:
        return self.saga

    async def get_phase_for_raid(self, raid_id: UUID) -> Phase | None:
        return None

    async def save_phase(self, phase: object, *, conn: object = None) -> None:
        pass

    async def save_raid(self, raid: object, *, conn: object = None) -> None:
        pass

    async def all_raids_merged(self, phase_id: UUID) -> bool:
        return False


class StubChannelFactory(NotificationChannelFactory):
    """Factory that returns pre-configured channels."""

    def __init__(self, channels: dict[str, list[NotificationChannel]] | None = None) -> None:
        self._channels = channels or {}

    async def for_owner(self, owner_id: str) -> list[NotificationChannel]:
        return self._channels.get(owner_id, [])


def _make_raid(
    raid_id: UUID | None = None,
    status: RaidStatus = RaidStatus.REVIEW,
    tracker_id: str = "NIU-100",
    pr_url: str | None = None,
) -> Raid:
    return Raid(
        id=raid_id or uuid4(),
        phase_id=uuid4(),
        tracker_id=tracker_id,
        name="Test raid",
        description="Implement feature",
        acceptance_criteria=["tests pass"],
        declared_files=["src/main.py"],
        estimate_hours=2.0,
        status=status,
        confidence=0.5,
        session_id="session-1",
        branch="raid/test",
        chronicle_summary=None,
        pr_url=pr_url,
        pr_id=None,
        retry_count=0,
        created_at=NOW,
        updated_at=NOW,
    )


def _make_saga(owner_id: str = "user-1") -> Saga:
    return Saga(
        id=uuid4(),
        tracker_id="proj-1",
        tracker_type="mock",
        slug="alpha",
        name="Test Saga",
        repos=["org/repo"],
        feature_branch="feat/test",
        status=SagaStatus.ACTIVE,
        confidence=0.5,
        created_at=NOW,
        owner_id=owner_id,
    )


# ---------------------------------------------------------------------------
# NotificationChannel port tests
# ---------------------------------------------------------------------------


class TestNotificationModel:
    def test_notification_fields(self) -> None:
        n = Notification(
            title="Test",
            body="Body text",
            urgency=NotificationUrgency.HIGH,
            owner_id="user-1",
            event_type="raid.review",
        )
        assert n.title == "Test"
        assert n.urgency == NotificationUrgency.HIGH
        assert n.metadata == {}

    def test_notification_with_metadata(self) -> None:
        n = Notification(
            title="Test",
            body="Body",
            urgency=NotificationUrgency.LOW,
            owner_id="user-1",
            event_type="raid.merged",
            metadata={"pr_url": "https://example.com"},
        )
        assert n.metadata["pr_url"] == "https://example.com"


class TestNotificationUrgency:
    def test_urgency_values(self) -> None:
        assert NotificationUrgency.LOW == "low"
        assert NotificationUrgency.MEDIUM == "medium"
        assert NotificationUrgency.HIGH == "high"


# ---------------------------------------------------------------------------
# TelegramNotificationAdapter tests
# ---------------------------------------------------------------------------


class TestTelegramNotificationAdapter:
    def test_should_notify_all_urgencies(self) -> None:
        adapter = TelegramNotificationAdapter(bot_token="tok", chat_id="123", min_urgency="low")
        for urgency in NotificationUrgency:
            n = Notification(title="T", body="B", urgency=urgency, owner_id="u", event_type="e")
            assert adapter.should_notify(n) is True

    def test_should_notify_medium_filter(self) -> None:
        adapter = TelegramNotificationAdapter(bot_token="tok", chat_id="123", min_urgency="medium")
        low = Notification(
            title="T", body="B", urgency=NotificationUrgency.LOW, owner_id="u", event_type="e"
        )
        medium = Notification(
            title="T", body="B", urgency=NotificationUrgency.MEDIUM, owner_id="u", event_type="e"
        )
        high = Notification(
            title="T", body="B", urgency=NotificationUrgency.HIGH, owner_id="u", event_type="e"
        )
        assert adapter.should_notify(low) is False
        assert adapter.should_notify(medium) is True
        assert adapter.should_notify(high) is True

    def test_should_notify_high_filter(self) -> None:
        adapter = TelegramNotificationAdapter(bot_token="tok", chat_id="123", min_urgency="high")
        low = Notification(
            title="T", body="B", urgency=NotificationUrgency.LOW, owner_id="u", event_type="e"
        )
        high = Notification(
            title="T", body="B", urgency=NotificationUrgency.HIGH, owner_id="u", event_type="e"
        )
        assert adapter.should_notify(low) is False
        assert adapter.should_notify(high) is True

    def test_format_message_basic(self) -> None:
        n = Notification(
            title="Raid ready",
            body="Raid NIU-100 is ready.",
            urgency=NotificationUrgency.HIGH,
            owner_id="u",
            event_type="raid.review",
        )
        msg = TelegramNotificationAdapter._format_message(n)
        assert "*Raid ready*" in msg
        assert "Raid NIU-100 is ready." in msg

    def test_format_message_with_pr_url(self) -> None:
        n = Notification(
            title="Raid ready",
            body="Raid NIU-100 is ready.",
            urgency=NotificationUrgency.HIGH,
            owner_id="u",
            event_type="raid.review",
            metadata={"pr_url": "https://github.com/org/repo/pull/42"},
        )
        msg = TelegramNotificationAdapter._format_message(n)
        assert "[View PR](https://github.com/org/repo/pull/42)" in msg

    def test_format_message_with_tracker_id(self) -> None:
        n = Notification(
            title="Raid ready",
            body="Raid NIU-100 is ready.",
            urgency=NotificationUrgency.HIGH,
            owner_id="u",
            event_type="raid.review",
            metadata={"tracker_id": "NIU-100"},
        )
        msg = TelegramNotificationAdapter._format_message(n)
        assert "Ticket: NIU-100" in msg

    @pytest.mark.asyncio
    async def test_send_no_bot_token(self) -> None:
        """Send with empty bot_token should not raise."""
        adapter = TelegramNotificationAdapter(bot_token="", chat_id="123")
        n = Notification(
            title="T", body="B", urgency=NotificationUrgency.HIGH, owner_id="u", event_type="e"
        )
        await adapter.send(n)  # Should not raise

    @pytest.mark.asyncio
    async def test_send_http_error_does_not_raise(self) -> None:
        """HTTP errors should be logged, not raised."""
        import respx

        with respx.mock:
            respx.post("https://api.telegram.org/bottok/sendMessage").respond(500)
            adapter = TelegramNotificationAdapter(bot_token="tok", chat_id="123")
            n = Notification(
                title="T", body="B", urgency=NotificationUrgency.HIGH, owner_id="u", event_type="e"
            )
            await adapter.send(n)  # Should not raise
            await adapter.close()

    @pytest.mark.asyncio
    async def test_send_success(self) -> None:
        """Successful send should call Telegram API."""
        import respx

        with respx.mock:
            route = respx.post("https://api.telegram.org/bottok123/sendMessage").respond(
                200, json={"ok": True}
            )
            adapter = TelegramNotificationAdapter(bot_token="tok123", chat_id="456")
            n = Notification(
                title="Raid ready",
                body="Raid NIU-100 is ready.",
                urgency=NotificationUrgency.HIGH,
                owner_id="u",
                event_type="raid.review",
            )
            await adapter.send(n)

            assert route.called
            await adapter.close()

    @pytest.mark.asyncio
    async def test_send_connection_error_does_not_raise(self) -> None:
        """Connection errors should be caught, not raised."""
        import respx

        with respx.mock:
            respx.post("https://api.telegram.org/bottok/sendMessage").mock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            adapter = TelegramNotificationAdapter(bot_token="tok", chat_id="123")
            n = Notification(
                title="T", body="B", urgency=NotificationUrgency.HIGH, owner_id="u", event_type="e"
            )
            await adapter.send(n)  # Should not raise
            await adapter.close()


# ---------------------------------------------------------------------------
# NotificationChannelFactory tests
# ---------------------------------------------------------------------------


class TestNotificationChannelFactory:
    @pytest.mark.asyncio
    async def test_no_connections(self) -> None:
        repo = StubIntegrationRepo()
        cred_store = StubCredentialStore()
        factory = NotificationChannelFactory(repo, cred_store)
        channels = await factory.for_owner("user-1")
        assert channels == []

    @pytest.mark.asyncio
    async def test_disabled_connection_skipped(self) -> None:
        conn = IntegrationConnection(
            id="conn-1",
            owner_id="user-1",
            integration_type=IntegrationType.MESSAGING,
            adapter="tyr.adapters.telegram_notification.TelegramNotificationAdapter",
            credential_name="tg-cred",
            config={"chat_id": "123"},
            enabled=False,
            created_at=NOW,
            updated_at=NOW,
        )
        repo = StubIntegrationRepo(connections=[conn])
        cred_store = StubCredentialStore(values={"user:user-1:tg-cred": {"bot_token": "tok"}})
        factory = NotificationChannelFactory(repo, cred_store)
        channels = await factory.for_owner("user-1")
        assert channels == []

    @pytest.mark.asyncio
    async def test_missing_credential_skipped(self) -> None:
        conn = IntegrationConnection(
            id="conn-1",
            owner_id="user-1",
            integration_type=IntegrationType.MESSAGING,
            adapter="tyr.adapters.telegram_notification.TelegramNotificationAdapter",
            credential_name="tg-cred",
            config={"chat_id": "123"},
            enabled=True,
            created_at=NOW,
            updated_at=NOW,
        )
        repo = StubIntegrationRepo(connections=[conn])
        cred_store = StubCredentialStore()  # No credentials
        factory = NotificationChannelFactory(repo, cred_store)
        channels = await factory.for_owner("user-1")
        assert channels == []

    @pytest.mark.asyncio
    async def test_valid_connection_creates_adapter(self) -> None:
        conn = IntegrationConnection(
            id="conn-1",
            owner_id="user-1",
            integration_type=IntegrationType.MESSAGING,
            adapter="tyr.adapters.telegram_notification.TelegramNotificationAdapter",
            credential_name="tg-cred",
            config={"chat_id": "123"},
            enabled=True,
            created_at=NOW,
            updated_at=NOW,
        )
        repo = StubIntegrationRepo(connections=[conn])
        cred_store = StubCredentialStore(values={"user:user-1:tg-cred": {"bot_token": "tok"}})
        factory = NotificationChannelFactory(repo, cred_store)
        channels = await factory.for_owner("user-1")
        assert len(channels) == 1
        assert isinstance(channels[0], TelegramNotificationAdapter)

    @pytest.mark.asyncio
    async def test_invalid_adapter_path_skipped(self) -> None:
        conn = IntegrationConnection(
            id="conn-1",
            owner_id="user-1",
            integration_type=IntegrationType.MESSAGING,
            adapter="nonexistent.module.Adapter",
            credential_name="cred",
            config={},
            enabled=True,
            created_at=NOW,
            updated_at=NOW,
        )
        repo = StubIntegrationRepo(connections=[conn])
        cred_store = StubCredentialStore(values={"user:user-1:cred": {"key": "val"}})
        factory = NotificationChannelFactory(repo, cred_store)
        channels = await factory.for_owner("user-1")
        assert channels == []

    @pytest.mark.asyncio
    async def test_multiple_connections(self) -> None:
        conns = [
            IntegrationConnection(
                id=f"conn-{i}",
                owner_id="user-1",
                integration_type=IntegrationType.MESSAGING,
                adapter="tyr.adapters.telegram_notification.TelegramNotificationAdapter",
                credential_name=f"tg-cred-{i}",
                config={"chat_id": f"chat-{i}"},
                enabled=True,
                created_at=NOW,
                updated_at=NOW,
            )
            for i in range(3)
        ]
        repo = StubIntegrationRepo(connections=conns)
        cred_store = StubCredentialStore(
            values={f"user:user-1:tg-cred-{i}": {"bot_token": f"tok-{i}"} for i in range(3)}
        )
        factory = NotificationChannelFactory(repo, cred_store)
        channels = await factory.for_owner("user-1")
        assert len(channels) == 3


# ---------------------------------------------------------------------------
# NotificationService tests
# ---------------------------------------------------------------------------


class TestNotificationServiceLifecycle:
    @pytest.mark.asyncio
    async def test_start_stop(self) -> None:
        event_bus = EventBus()
        factory = StubChannelFactory()
        raid_repo = StubRaidRepo()
        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)

        assert service.running is False
        await service.start()
        assert service.running is True
        assert event_bus.client_count == 1

        await service.stop()
        assert service.running is False
        assert event_bus.client_count == 0

    @pytest.mark.asyncio
    async def test_stop_when_not_started(self) -> None:
        event_bus = EventBus()
        factory = StubChannelFactory()
        raid_repo = StubRaidRepo()
        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.stop()  # Should not raise


class TestNotificationServiceEventMapping:
    @pytest.mark.asyncio
    async def test_raid_review_notification(self) -> None:
        """raid.state_changed → REVIEW should produce a HIGH urgency notification."""
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        raid = _make_raid(tracker_id="NIU-200")
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga(owner_id="user-1")

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={
                    "raid_id": str(raid.id),
                    "status": "REVIEW",
                    "tracker_id": "NIU-200",
                    "pr_url": "https://github.com/org/repo/pull/1",
                },
            )
        )

        # Give the background task time to process
        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 1
        n = channel.sent[0]
        assert n.urgency == NotificationUrgency.HIGH
        assert "NIU-200" in n.body
        assert n.owner_id == "user-1"
        assert n.metadata.get("pr_url") == "https://github.com/org/repo/pull/1"

    @pytest.mark.asyncio
    async def test_raid_failed_notification(self) -> None:
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        raid = _make_raid(tracker_id="NIU-201", status=RaidStatus.FAILED)
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga(owner_id="user-1")

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={
                    "raid_id": str(raid.id),
                    "status": "FAILED",
                    "tracker_id": "NIU-201",
                    "retry_count": 2,
                },
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 1
        n = channel.sent[0]
        assert n.urgency == NotificationUrgency.HIGH
        assert "failed" in n.title.lower()
        assert "NIU-201" in n.body

    @pytest.mark.asyncio
    async def test_raid_merged_notification(self) -> None:
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        raid = _make_raid(tracker_id="NIU-202", status=RaidStatus.MERGED)
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga(owner_id="user-1")

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={
                    "raid_id": str(raid.id),
                    "status": "MERGED",
                    "tracker_id": "NIU-202",
                },
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 1
        assert channel.sent[0].urgency == NotificationUrgency.LOW

    @pytest.mark.asyncio
    async def test_unmapped_status_ignored(self) -> None:
        """Events with statuses not in the mapping should be ignored."""
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()
        raid_repo.saga = _make_saga(owner_id="user-1")

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={"raid_id": str(uuid4()), "status": "RUNNING"},
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 0

    @pytest.mark.asyncio
    async def test_unknown_event_type_ignored(self) -> None:
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(TyrEvent(event="some.unknown.event", data={"foo": "bar"}))

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 0

    @pytest.mark.asyncio
    async def test_no_owner_found_skips_notification(self) -> None:
        """Events where owner cannot be resolved should be skipped."""
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()
        # saga is None → owner cannot be resolved

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={"raid_id": str(uuid4()), "status": "REVIEW"},
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 0

    @pytest.mark.asyncio
    async def test_no_channels_configured(self) -> None:
        """If owner has no channels, notification is silently dropped."""
        event_bus = EventBus()
        factory = StubChannelFactory()  # No channels for anyone
        raid_repo = StubRaidRepo()

        raid = _make_raid(tracker_id="NIU-300")
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga(owner_id="user-1")

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={"raid_id": str(raid.id), "status": "REVIEW", "tracker_id": "NIU-300"},
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()
        # No assertion needed — just verifying no crash

    @pytest.mark.asyncio
    async def test_channel_send_error_does_not_crash(self) -> None:
        """If a channel fails to send, other channels still get notified."""
        event_bus = EventBus()
        failing = FailingChannel()
        recording = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [failing, recording]})
        raid_repo = StubRaidRepo()

        raid = _make_raid(tracker_id="NIU-400")
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga(owner_id="user-1")

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={"raid_id": str(raid.id), "status": "REVIEW", "tracker_id": "NIU-400"},
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(recording.sent) == 1

    @pytest.mark.asyncio
    async def test_urgency_filter_respected(self) -> None:
        """Channel with high min_urgency should skip low notifications."""
        event_bus = EventBus()
        channel = RecordingChannel(min_urgency=NotificationUrgency.HIGH)
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        raid = _make_raid(tracker_id="NIU-500", status=RaidStatus.MERGED)
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga(owner_id="user-1")

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={"raid_id": str(raid.id), "status": "MERGED", "tracker_id": "NIU-500"},
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 0

    @pytest.mark.asyncio
    async def test_saga_pr_created_notification(self) -> None:
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="saga.pr_created",
                data={
                    "owner_id": "user-1",
                    "saga_name": "Auth rewrite",
                    "pr_url": "https://github.com/org/repo/pull/99",
                },
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 1
        n = channel.sent[0]
        assert n.urgency == NotificationUrgency.HIGH
        assert "Auth rewrite" in n.body
        assert n.metadata.get("pr_url") == "https://github.com/org/repo/pull/99"

    @pytest.mark.asyncio
    async def test_saga_pr_created_no_owner(self) -> None:
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(TyrEvent(event="saga.pr_created", data={"saga_name": "X"}))

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 0

    @pytest.mark.asyncio
    async def test_phase_unlocked_notification(self) -> None:
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="phase.unlocked",
                data={
                    "owner_id": "user-1",
                    "phase_number": 2,
                    "queued_raids": 5,
                },
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 1
        n = channel.sent[0]
        assert n.urgency == NotificationUrgency.MEDIUM
        assert "Phase 2" in n.body
        assert "5 raids" in n.body

    @pytest.mark.asyncio
    async def test_phase_unlocked_no_owner(self) -> None:
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(event="phase.unlocked", data={"phase_number": 1, "queued_raids": 3})
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 0

    @pytest.mark.asyncio
    async def test_confidence_below_threshold(self) -> None:
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        raid = _make_raid(tracker_id="NIU-600")
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga(owner_id="user-1")

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="confidence.updated",
                data={
                    "raid_id": str(raid.id),
                    "score_after": 0.2,
                    "tracker_id": "NIU-600",
                },
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 1
        n = channel.sent[0]
        assert n.urgency == NotificationUrgency.MEDIUM
        assert "20%" in n.body

    @pytest.mark.asyncio
    async def test_confidence_above_threshold_ignored(self) -> None:
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        await event_bus.emit(
            TyrEvent(
                event="confidence.updated",
                data={"raid_id": str(uuid4()), "score_after": 0.5},
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 0

    @pytest.mark.asyncio
    async def test_tracker_id_resolved_from_raid(self) -> None:
        """When event data lacks tracker_id, resolve from raid repo."""
        event_bus = EventBus()
        channel = RecordingChannel()
        factory = StubChannelFactory(channels={"user-1": [channel]})
        raid_repo = StubRaidRepo()

        raid = _make_raid(tracker_id="NIU-700")
        raid_repo.raids[raid.id] = raid
        raid_repo.saga = _make_saga(owner_id="user-1")

        service = NotificationService(event_bus, factory, raid_repo, confidence_threshold=0.3)
        await service.start()

        # Emit without tracker_id in data
        await event_bus.emit(
            TyrEvent(
                event="raid.state_changed",
                data={"raid_id": str(raid.id), "status": "REVIEW"},
            )
        )

        await asyncio.sleep(0.1)
        await service.stop()

        assert len(channel.sent) == 1
        assert "NIU-700" in channel.sent[0].body


# ---------------------------------------------------------------------------
# Config tests
# ---------------------------------------------------------------------------


class TestNotificationConfig:
    def test_defaults(self) -> None:
        from tyr.config import NotificationConfig

        cfg = NotificationConfig()
        assert cfg.enabled is True
        assert cfg.confidence_threshold == 0.3

    def test_custom(self) -> None:
        from tyr.config import NotificationConfig

        cfg = NotificationConfig(enabled=False, confidence_threshold=0.5)
        assert cfg.enabled is False
        assert cfg.confidence_threshold == 0.5

    def test_settings_includes_notification(self) -> None:
        from tyr.config import Settings

        s = Settings()
        assert hasattr(s, "notification")
        assert s.notification.enabled is True
