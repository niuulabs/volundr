"""
Sleipnir event publishing adapter for Ravn.
Connects Ravn to the ODIN event backbone.
"""

import abc
import logging
from typing import Any

import msgpack

try:
    import pynng
except ImportError:
    pynng = None

logger = logging.getLogger(__name__)


class EventPublisher(abc.ABC):
    """Abstract base class for event publishing."""

    @abc.abstractmethod
    async def publish(self, event: Any) -> None:
        """Publish a RavnEvent."""
        pass

    @abc.abstractmethod
    async def close(self) -> None:
        """Close the publisher."""
        pass


class SleipnirPublisher(EventPublisher):
    """Publishes RavnEvents to Sleipnir using nng PUB socket.

    Uses msgpack serialization.
    """

    def __init__(self, address: str, fallback_logger: logging.Logger | None = None):
        """Initialize the Sleipnir publisher.

        Args:
            address: IPC or TCP address (e.g., 'ipc:///tmp/sleipnir.ipc').
            fallback_logger: Logger to use if Sleipnir is unavailable.
        """
        self.address = address
        self.fallback_logger = fallback_logger or logger
        self.socket: pynng.Pub | None = None
        self._is_connected = False

    async def connect(self) -> None:
        """Establish connection to Sleipnir."""
        if pynng is None:
            self.fallback_logger.error("pynng is not installed. Sleipnir publishing disabled.")
            return

        try:
            self.socket = pynng.Pub(listen=False)
            self.socket.dial(self.address)
            self._is_connected = True
            logger.info("Connected to Sleipnir at %s", self.address)
        except Exception as e:
            self.fallback_logger.warning(
                "Failed to connect to Sleipnir at %s: %s. Falling back to CLI.",
                self.address,
                e,
            )
            self._is_connected = False

    async def publish(self, event: Any) -> None:
        """Publish a RavnEvent.

        Args:
            event: A RavnEvent instance.
        """
        data = {
            "type": event.type,
            "source": event.source,
            "payload": event.payload,
            "timestamp": event.timestamp.timestamp(),
            "urgency": event.urgency,
            "correlation_id": event.correlation_id,
            "session_id": event.session_id,
            "task_id": event.task_id,
        }

        packed_data = msgpack.packb(data, use_bin_type=True)

        if not self._is_connected or self.socket is None:
            self.fallback_logger.info("[FALLBACK] %s: %s", event.type.upper(), event.payload)
            return

        try:
            self.socket.send(packed_data)
        except Exception as e:
            self.fallback_logger.warning(
                "Failed to publish event to Sleipnir: %s. Falling back to CLI.", e
            )
            self.fallback_logger.info("[FALLBACK] %s: %s", event.type.upper(), event.payload)
            self._is_connected = False

    async def close(self) -> None:
        """Close the connection."""
        if self.socket:
            self.socket.close()
            self.socket = None
        self._is_connected = False
        logger.info("Sleipnir publisher closed.")
