"""Notification channel port — interface for outbound notification delivery."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import StrEnum


class NotificationUrgency(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True)
class Notification:
    """A notification to be delivered to a user."""

    title: str
    body: str
    urgency: NotificationUrgency
    owner_id: str
    event_type: str
    metadata: dict[str, str] = field(default_factory=dict)


class NotificationChannel(ABC):
    """Outbound notification channel (Telegram, Slack, etc.)."""

    @abstractmethod
    async def send(self, notification: Notification) -> None:
        """Deliver a notification through this channel."""
        ...

    @abstractmethod
    def should_notify(self, notification: Notification) -> bool:
        """Return True if this channel should handle the given notification."""
        ...
