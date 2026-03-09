"""Tests for the local in-process Synapse adapter."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from volundr.bifrost.adapters.synapse_local import LocalSynapse
from volundr.bifrost.models import SynapseEnvelope


def _make_envelope(topic: str = "test.topic", **payload) -> SynapseEnvelope:
    return SynapseEnvelope(
        topic=topic,
        session_id="session-1",
        project_id="project-1",
        timestamp=datetime.now(UTC),
        trace_id="trace-1",
        payload=payload or {"key": "value"},
    )


class TestPublishSubscribe:
    async def test_subscriber_receives_message(self):
        synapse = LocalSynapse()
        received: list[SynapseEnvelope] = []

        async def handler(msg: SynapseEnvelope) -> None:
            received.append(msg)

        await synapse.subscribe("test.topic", handler)

        envelope = _make_envelope()
        await synapse.publish("test.topic", envelope)

        # Allow task to run
        await asyncio.sleep(0.05)

        assert len(received) == 1
        assert received[0].payload == {"key": "value"}
        await synapse.close()

    async def test_multiple_subscribers_all_receive(self):
        synapse = LocalSynapse()
        received_a: list[SynapseEnvelope] = []
        received_b: list[SynapseEnvelope] = []

        async def handler_a(msg: SynapseEnvelope) -> None:
            received_a.append(msg)

        async def handler_b(msg: SynapseEnvelope) -> None:
            received_b.append(msg)

        await synapse.subscribe("test.topic", handler_a)
        await synapse.subscribe("test.topic", handler_b)

        await synapse.publish("test.topic", _make_envelope())
        await asyncio.sleep(0.05)

        assert len(received_a) == 1
        assert len(received_b) == 1
        await synapse.close()

    async def test_no_subscriber_publishes_silently(self):
        synapse = LocalSynapse()
        # Should not raise
        await synapse.publish("no.subscribers", _make_envelope("no.subscribers"))
        await synapse.close()

    async def test_different_topics_are_isolated(self):
        synapse = LocalSynapse()
        received: list[SynapseEnvelope] = []

        async def handler(msg: SynapseEnvelope) -> None:
            received.append(msg)

        await synapse.subscribe("topic.a", handler)

        await synapse.publish("topic.b", _make_envelope("topic.b"))
        await asyncio.sleep(0.05)

        assert len(received) == 0
        await synapse.close()


class TestErrorHandling:
    async def test_handler_exception_is_swallowed(self):
        synapse = LocalSynapse()
        received_after: list[SynapseEnvelope] = []

        async def bad_handler(msg: SynapseEnvelope) -> None:
            raise ValueError("handler crashed")

        async def good_handler(msg: SynapseEnvelope) -> None:
            received_after.append(msg)

        await synapse.subscribe("test.topic", bad_handler)
        await synapse.subscribe("test.topic", good_handler)

        await synapse.publish("test.topic", _make_envelope())
        await asyncio.sleep(0.05)

        # Good handler still received the message despite bad handler crashing
        assert len(received_after) == 1
        await synapse.close()


class TestClose:
    async def test_publish_after_close_is_silent(self):
        synapse = LocalSynapse()
        received: list[SynapseEnvelope] = []

        async def handler(msg: SynapseEnvelope) -> None:
            received.append(msg)

        await synapse.subscribe("test.topic", handler)
        await synapse.close()

        await synapse.publish("test.topic", _make_envelope())
        await asyncio.sleep(0.05)

        assert len(received) == 0

    async def test_close_clears_subscribers(self):
        synapse = LocalSynapse()

        async def handler(msg: SynapseEnvelope) -> None:
            pass

        await synapse.subscribe("test.topic", handler)
        assert len(synapse._subscribers) == 1

        await synapse.close()
        assert len(synapse._subscribers) == 0
