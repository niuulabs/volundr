# Adding a New Channel

This guide walks through adding a new communication channel adapter to Ravn's
gateway system.

## Step 1: Implement ChannelPort

Create a new adapter in `src/ravn/adapters/channels/`:

```python
# src/ravn/adapters/channels/my_channel.py
from collections.abc import AsyncIterator

from ravn.domain.events import RavnEvent
from ravn.ports.channel import ChannelPort


class MyChannelAdapter(ChannelPort):
    """Adapter for MyChannel messaging platform."""

    def __init__(
        self,
        api_key: str = "",
        poll_interval: float = 1.0,
    ):
        self._api_key = api_key
        self._poll_interval = poll_interval
        self._running = False

    async def start(self) -> None:
        """Initialize connection to the messaging platform."""
        self._running = True
        # Connect to API, authenticate, etc.

    async def stop(self) -> None:
        """Gracefully disconnect."""
        self._running = False
        # Close connections, flush buffers

    async def receive(self) -> AsyncIterator[dict]:
        """Yield incoming messages from the platform."""
        while self._running:
            messages = await self._poll_messages()
            for msg in messages:
                yield {
                    "session_id": msg.conversation_id,
                    "content": msg.text,
                    "sender": msg.author,
                }

    async def emit(self, event: RavnEvent) -> None:
        """Send an event to the messaging platform."""
        match event.type:
            case "text_delta":
                # Buffer text and send when complete
                self._buffer.append(event.content)
            case "message_done":
                # Flush buffered text as a message
                text = "".join(self._buffer)
                await self._send_message(event.session_id, text)
                self._buffer.clear()
            case "tool_call":
                # Optionally show tool usage
                pass
```

### ChannelPort Interface

| Method | Description |
|--------|-------------|
| `start()` | Initialize the channel connection. |
| `stop()` | Gracefully shut down. |
| `receive()` | Async iterator yielding incoming messages. |
| `emit(event)` | Send an outbound event to the channel. |

## Step 2: Event Translation

Each channel needs to translate between Ravn's `StreamEvent` format and the
platform's native message format.

Ravn emits these event types:

| Event | Action |
|-------|--------|
| `text_delta` | Buffer text content. |
| `tool_call` | Optionally display tool usage to user. |
| `tool_result` | Optionally display tool output. |
| `message_done` | Flush buffered text as a complete message. |
| `thinking` | Optionally show thinking indicator. |

Most channels buffer `text_delta` events and send the complete message on
`message_done`. Some channels (WebSocket, SSE) stream deltas directly.

## Step 3: Add Channel Configuration

Add a config class in `src/ravn/config.py`:

```python
class MyChannelConfig(BaseModel):
    api_key_env: str = ""
    poll_interval: float = 1.0
    max_message_length: int = 4096
```

Add to `GatewayChannelsConfig`:

```python
class GatewayChannelsConfig(BaseModel):
    # ... existing channels ...
    my_channel: MyChannelConfig = MyChannelConfig()
```

## Step 4: Wire in Gateway

Register the channel in the gateway startup logic so it's created when
configured:

```python
if settings.gateway.channels.my_channel.api_key_env:
    api_key = os.environ.get(settings.gateway.channels.my_channel.api_key_env, "")
    if api_key:
        channels.append(
            MyChannelAdapter(
                api_key=api_key,
                poll_interval=settings.gateway.channels.my_channel.poll_interval,
            )
        )
```

## Step 5: Handle Platform Constraints

Different platforms have different constraints:

| Constraint | How to Handle |
|-----------|---------------|
| Message length limits | Split long responses into multiple messages. |
| Rate limits | Add backoff/queuing logic. |
| Markdown support | Convert Ravn's Markdown to platform format. |
| Rich content (images, files) | Map to platform attachments or skip. |
| Threading | Map Ravn sessions to platform threads. |

## Step 6: Write Tests

```python
import pytest
from ravn.adapters.channels.my_channel import MyChannelAdapter
from ravn.domain.events import RavnEvent


@pytest.fixture
def channel():
    return MyChannelAdapter(api_key="test")


class TestMyChannelAdapter:
    @pytest.mark.asyncio
    async def test_start_stop(self, channel):
        await channel.start()
        await channel.stop()

    @pytest.mark.asyncio
    async def test_emit_text(self, channel):
        await channel.start()
        event = RavnEvent(type="text_delta", content="hello")
        await channel.emit(event)
        done = RavnEvent(type="message_done", session_id="s1")
        await channel.emit(done)
        await channel.stop()
```

## Configuration Example

```yaml
gateway:
  enabled: true
  channels:
    my_channel:
      api_key_env: "MY_CHANNEL_API_KEY"
      poll_interval: 1.0
      max_message_length: 4096
```
