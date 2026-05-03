from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from niuu.domain.models import IntegrationConnection, IntegrationType
from volundr.domain.services.telegram_ingress import (
    TelegramIngressService,
    build_test_update,
)


@dataclass
class _FakeIntegrationRepo:
    connections: list[IntegrationConnection]

    async def list_connections_global(
        self,
        integration_type: IntegrationType | None = None,
        *,
        slug: str | None = None,
        enabled_only: bool = False,
    ) -> list[IntegrationConnection]:
        results = list(self.connections)
        if integration_type is not None:
            results = [c for c in results if c.integration_type == integration_type]
        if slug is not None:
            results = [c for c in results if c.slug == slug]
        if enabled_only:
            results = [c for c in results if c.enabled]
        return results


class _FakeCredentialStore:
    def __init__(self, values: dict[tuple[str, str, str], dict[str, str]]) -> None:
        self._values = values

    async def get_value(self, owner_type: str, owner_id: str, name: str):
        return self._values.get((owner_type, owner_id, name))


class _FakeCommunicationIngress:
    def __init__(self) -> None:
        self.messages = []

    async def handle_inbound_message(self, message) -> None:
        self.messages.append(message)


class _FakeCursorRepo:
    def __init__(self, values: dict[tuple[str, str], str] | None = None) -> None:
        self.values = values or {}
        self.upserts: list[tuple[str, str, str]] = []

    async def get_cursor(self, platform: str, consumer_key: str) -> str | None:
        return self.values.get((platform, consumer_key))

    async def upsert_cursor(self, platform: str, consumer_key: str, cursor: str) -> None:
        self.values[(platform, consumer_key)] = cursor
        self.upserts.append((platform, consumer_key, cursor))


def _connection(
    *,
    owner_id: str,
    credential_name: str,
    enabled: bool = True,
    slug: str = "telegram",
) -> IntegrationConnection:
    return IntegrationConnection(
        id=str(uuid4()),
        owner_id=owner_id,
        integration_type=IntegrationType.MESSAGING,
        adapter="tyr.adapters.telegram_notification.TelegramNotificationAdapter",
        credential_name=credential_name,
        config={},
        enabled=enabled,
        slug=slug,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


async def test_load_bindings_deduplicates_shared_bot_tokens():
    ingress = _FakeCommunicationIngress()
    service = TelegramIngressService(
        integration_repo=_FakeIntegrationRepo(
            [
                _connection(owner_id="u1", credential_name="telegram-a"),
                _connection(owner_id="u2", credential_name="telegram-b"),
                _connection(owner_id="u3", credential_name="telegram-c"),
            ]
        ),
        credential_store=_FakeCredentialStore(
            {
                ("user", "u1", "telegram-a"): {"bot_token": "token-1"},
                ("user", "u2", "telegram-b"): {"bot_token": "token-1"},
                ("user", "u3", "telegram-c"): {"bot_token": "token-2"},
            }
        ),
        communication_ingress=ingress,
    )

    bindings = await service._load_bindings()

    assert len(bindings) == 2
    by_token = {binding.bot_token: binding for binding in bindings}
    assert by_token["token-1"].owner_ids == ("u1", "u2")
    assert by_token["token-2"].owner_ids == ("u3",)


async def test_handle_update_normalizes_telegram_message():
    ingress = _FakeCommunicationIngress()
    service = TelegramIngressService(
        integration_repo=_FakeIntegrationRepo([]),
        credential_store=_FakeCredentialStore({}),
        communication_ingress=ingress,
    )

    update = build_test_update(
        update_id=42,
        chat_id=-1003841286227,
        message_thread_id=7,
        text="@coder hello",
        sender_id=7637020486,
        sender_name="Jozef",
        sender_username="Jozef_85",
    )

    await service._handle_update(update)

    assert len(ingress.messages) == 1
    message = ingress.messages[0]
    assert message.platform.value == "telegram"
    assert message.conversation_id == "-1003841286227"
    assert message.thread_id == "7"
    assert message.sender_external_id == "7637020486"
    assert message.sender_display_name == "Jozef_85"
    assert message.text == "@coder hello"


async def test_handle_update_ignores_bot_messages():
    ingress = _FakeCommunicationIngress()
    service = TelegramIngressService(
        integration_repo=_FakeIntegrationRepo([]),
        credential_store=_FakeCredentialStore({}),
        communication_ingress=ingress,
    )

    update = build_test_update(
        update_id=43,
        chat_id=-1003841286227,
        text="status",
        is_bot=True,
    )

    await service._handle_update(update)

    assert ingress.messages == []


async def test_handle_update_accepts_caption_from_topic_message():
    ingress = _FakeCommunicationIngress()
    service = TelegramIngressService(
        integration_repo=_FakeIntegrationRepo([]),
        credential_store=_FakeCredentialStore({}),
        communication_ingress=ingress,
    )

    update = build_test_update(
        update_id=44,
        chat_id=-1003841286227,
        message_thread_id=9,
        text="",
        sender_name="Jozef",
    )
    update.message.text = None
    update.message.caption = "please look"

    await service._handle_update(update)

    assert len(ingress.messages) == 1
    assert ingress.messages[0].text == "please look"


async def test_load_offset_reads_persisted_cursor():
    ingress = _FakeCommunicationIngress()
    cursor_repo = _FakeCursorRepo({("telegram", "consumer-1"): "77"})
    service = TelegramIngressService(
        integration_repo=_FakeIntegrationRepo([]),
        credential_store=_FakeCredentialStore({}),
        communication_ingress=ingress,
        cursor_repository=cursor_repo,
    )

    binding = type("Binding", (), {"bot_token": "token-1"})()

    # Reuse the real key derivation so the assertion stays aligned with the service.
    from volundr.domain.services.telegram_ingress import _consumer_key

    cursor_repo.values = {("telegram", _consumer_key("token-1")): "77"}

    offset = await service._load_offset(binding)

    assert offset == 77


async def test_store_offset_persists_cursor():
    ingress = _FakeCommunicationIngress()
    cursor_repo = _FakeCursorRepo()
    service = TelegramIngressService(
        integration_repo=_FakeIntegrationRepo([]),
        credential_store=_FakeCredentialStore({}),
        communication_ingress=ingress,
        cursor_repository=cursor_repo,
    )

    binding = type("Binding", (), {"bot_token": "token-1"})()

    await service._store_offset(binding, 123)

    assert len(cursor_repo.upserts) == 1
    platform, _, cursor = cursor_repo.upserts[0]
    assert platform == "telegram"
    assert cursor == "123"
