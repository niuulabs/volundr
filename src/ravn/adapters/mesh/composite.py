"""CompositeMeshAdapter — tries infra transport first, falls back to nng (NIU-517).

Designed for hybrid Pi+cluster deployments where a Pi Ravn may be talking to
a cluster Ravn: the infra (Sleipnir/RabbitMQ) adapter is attempted first, and
on failure the nng adapter is used as a fallback.

For ``publish`` and ``subscribe`` the composite delegates to both adapters so
that peers on either transport receive the message.  For ``send`` the infra
adapter is tried first; if it raises an exception the nng adapter is tried
next.  ``start`` and ``stop`` are applied to both adapters.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from ravn.domain.events import RavnEvent
from ravn.ports.mesh import MeshPort, PeerNotFoundError

logger = logging.getLogger(__name__)


class CompositeMeshAdapter:
    """Mesh adapter that delegates to *primary* first and *fallback* on error.

    Parameters
    ----------
    primary:
        The preferred transport (typically ``SleipnirMeshAdapter``).
    fallback:
        The fallback transport (typically ``NngMeshAdapter``).
    """

    def __init__(self, primary: MeshPort, fallback: MeshPort) -> None:
        self._primary = primary
        self._fallback = fallback

    async def publish(self, event: RavnEvent, topic: str) -> None:
        """Publish *event* via both adapters (best-effort)."""
        try:
            await self._primary.publish(event, topic)
        except Exception as exc:
            logger.debug("composite_mesh: primary publish failed (%s), trying fallback", exc)
        try:
            await self._fallback.publish(event, topic)
        except Exception as exc:
            logger.debug("composite_mesh: fallback publish failed (%s)", exc)

    async def subscribe(
        self,
        topic: str,
        handler: Callable[[RavnEvent], Awaitable[None]],
    ) -> None:
        """Subscribe to *topic* on both adapters."""
        try:
            await self._primary.subscribe(topic, handler)
        except Exception as exc:
            logger.debug("composite_mesh: primary subscribe failed (%s)", exc)
        try:
            await self._fallback.subscribe(topic, handler)
        except Exception as exc:
            logger.debug("composite_mesh: fallback subscribe failed (%s)", exc)

    async def unsubscribe(self, topic: str) -> None:
        """Unsubscribe from *topic* on both adapters."""
        for adapter in (self._primary, self._fallback):
            try:
                await adapter.unsubscribe(topic)
            except Exception as exc:
                logger.debug("composite_mesh: unsubscribe failed on %s: %s", adapter, exc)

    async def send(
        self,
        target_peer_id: str,
        message: dict,
        *,
        timeout_s: float = 10.0,
    ) -> dict:
        """Send *message* to *target_peer_id*, trying primary then fallback.

        Raises ``PeerNotFoundError`` only if both adapters report the peer as
        not found.  Raises the original ``TimeoutError`` if both adapters
        time out.
        """
        try:
            return await self._primary.send(target_peer_id, message, timeout_s=timeout_s)
        except PeerNotFoundError:
            logger.debug(
                "composite_mesh: peer %r not found in primary, trying fallback",
                target_peer_id,
            )
        except Exception as exc:
            logger.debug("composite_mesh: primary send failed (%s), trying fallback", exc)

        return await self._fallback.send(target_peer_id, message, timeout_s=timeout_s)

    async def start(self) -> None:
        """Start both adapters."""
        try:
            await self._primary.start()
        except Exception as exc:
            logger.warning("composite_mesh: primary start failed: %s", exc)
        try:
            await self._fallback.start()
        except Exception as exc:
            logger.warning("composite_mesh: fallback start failed: %s", exc)

    async def stop(self) -> None:
        """Stop both adapters."""
        for adapter in (self._primary, self._fallback):
            try:
                await adapter.stop()
            except Exception as exc:
                logger.debug("composite_mesh: stop failed on %s: %s", adapter, exc)
