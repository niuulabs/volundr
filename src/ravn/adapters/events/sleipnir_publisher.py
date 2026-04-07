"""
Sleipnir event publishing adapter for Ravn.
Connects Ravn to the ODIN event backbone.
"""

import abc
import logging
import msgpack
from datetime import datetime, timezone
from typing import Any

try:
    import pynng
except ImportError:
    pynng = None

import logging

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
    """
    Publishes RavnEvents to Sleipnir using nng PUB socket.
    Uses msgpack serialization.
    """

    def __init__(self, address: str, fallback_logger: logging.Logger | None = None):
        """
        Initialize the Sleipnir publisher.

        Args:
            address: IPC or TCP address (e.g., 'ipc:///tmp/sleipnir.ipc' or 'tcp://127.0.0.1:5555').
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
            logger.info(f"Connected to Sleipnir at {self.address}")
        except Exception as e:
            self.fallback_logger.warning(f"Failed to connect to Sleipnir at {self.address}: {e}. Falling back to CLI.")
            self._is_connected = False

    async def publish(self, event: Any) -> None:
        """
        Publishes a RavnEvent.
        
        Args:
            event: A RavnEvent instance.
        """
        # Prepare data for msgpack
        # We convert datetime to timestamp for easier serialization
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
            self.fallback_logger.info(f"[FALLBACK] {event.type.upper()}: {event.payload}")
            return

        try:
            self.socket.send(packed_data)
        except Exception as e:
            self.fallback_logger.warning(f"Failed to publish event to Sleipnir: {e}. Falling back to CLI.")
            self.fallback_logger.info(f"[FALLBACK] {event.type.upper()}: {event.payload}")
            # Try to reconnect on next attempt if it was a connection issue
            self._is_connected = False

    async def close(self) -> None:
        """Close the connection."""
        if self.socket:
            self.socket.close()
            self.socket = None
        self._is_connected = False
        logger.info("Sleipnir publisher closed.")
