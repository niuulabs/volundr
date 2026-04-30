from __future__ import annotations

import asyncio

import pytest

from niuu.ports.cli import CLITransport, TransportCapabilities
from ravn.adapters.executors.cli import CliTransportExecutor
from ravn.domain.checkpoint import InterruptReason
from ravn.domain.events import RavnEvent
from ravn.domain.models import Message, Session


class _CollectingChannel:
    def __init__(self) -> None:
        self.events: list[RavnEvent] = []

    async def emit(self, event: RavnEvent) -> None:
        self.events.append(event)


class FakeResumableTransport(CLITransport):
    def __init__(
        self,
        workspace_dir: str,
        *,
        model: str = "",
        session_id: str = "",
        system_prompt: str = "",
        skip_permissions: bool = True,
        initial_prompt: str = "",
    ) -> None:
        super().__init__()
        self.workspace_dir = workspace_dir
        self.model = model
        self._session_id = session_id
        self.system_prompt = system_prompt
        self.skip_permissions = skip_permissions
        self.initial_prompt = initial_prompt
        self.sent_messages: list[str] = []
        self._last_result: dict | None = None
        self.control_calls: list[tuple[str, dict]] = []

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def send_message(self, content: str) -> None:
        self.sent_messages.append(content)
        await self._emit(
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Working "}}
        )
        await self._emit(
            {
                "type": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "tool-1",
                        "name": "Bash",
                        "input": {"command": "ls"},
                    }
                ],
            }
        )
        await self._emit(
            {
                "type": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "tool-1",
                        "content": "ok",
                        "is_error": False,
                    }
                ],
            }
        )
        self._last_result = {
            "type": "result",
            "result": "Done",
            "stop_reason": "end_turn",
            "modelUsage": {
                "fake-model": {
                    "inputTokens": 10,
                    "outputTokens": 5,
                    "cacheReadInputTokens": 2,
                    "cacheCreationInputTokens": 1,
                }
            },
        }
        await self._emit(self._last_result)

    async def send_control(self, subtype: str, **kwargs: object) -> None:
        self.control_calls.append((subtype, kwargs))

    @property
    def session_id(self) -> str | None:
        return self._session_id

    @property
    def last_result(self) -> dict | None:
        return self._last_result

    @property
    def is_alive(self) -> bool:
        return True

    @property
    def capabilities(self) -> TransportCapabilities:
        return TransportCapabilities(session_resume=True, interrupt=True)


class FakeStatelessTransport(CLITransport):
    def __init__(self, workspace_dir: str, *, model: str = "") -> None:
        super().__init__()
        self.workspace_dir = workspace_dir
        self.model = model
        self.sent_messages: list[str] = []
        self._last_result: dict | None = None

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def send_message(self, content: str) -> None:
        self.sent_messages.append(content)
        self._last_result = {
            "type": "result",
            "result": "Stateless done",
            "stop_reason": "end_turn",
            "modelUsage": {"fake-model": {"inputTokens": 1, "outputTokens": 2}},
        }
        await self._emit(self._last_result)

    @property
    def session_id(self) -> str | None:
        return None

    @property
    def last_result(self) -> dict | None:
        return self._last_result

    @property
    def is_alive(self) -> bool:
        return True


@pytest.mark.asyncio
async def test_cli_executor_runs_turn_and_emits_ravn_events() -> None:
    channel = _CollectingChannel()
    executor = CliTransportExecutor(
        transport_adapter="tests.test_ravn.test_executor_cli.FakeResumableTransport"
    )
    agent = executor.build(
        channel=channel,
        system_prompt="You are a reviewer.",
        session=Session(),
        model="fake-model",
        max_iterations=3,
        checkpoint_port=None,
        task_id="task-1",
        persona="reviewer",
        workspace_dir="/tmp/workspace",
        permission_mode="read_only",
        tools=[],
    )

    result = await agent.run_turn("Review the patch")

    assert result.response == "Done"
    assert result.usage.input_tokens == 10
    assert result.usage.output_tokens == 5
    assert result.usage.cache_read_tokens == 2
    assert result.usage.cache_write_tokens == 1
    assert [call.name for call in result.tool_calls] == ["Bash"]
    assert [tool.content for tool in result.tool_results] == ["ok"]

    assert [event.type.value for event in channel.events] == [
        "thought",
        "tool_start",
        "tool_result",
        "response",
    ]
    assert channel.events[-1].payload["text"] == "Done"

    transport = agent._transport
    assert transport is not None
    assert transport.sent_messages == ["Review the patch"]


@pytest.mark.asyncio
async def test_cli_executor_renders_system_prompt_for_stateless_transport() -> None:
    channel = _CollectingChannel()
    session = Session()
    session.add_message(Message(role="assistant", content="Earlier answer"))
    executor = CliTransportExecutor(
        transport_adapter="tests.test_ravn.test_executor_cli.FakeStatelessTransport"
    )
    agent = executor.build(
        channel=channel,
        system_prompt="You are a coder.",
        session=session,
        model="fake-model",
        max_iterations=2,
        checkpoint_port=None,
        task_id="task-2",
        persona="coder",
        workspace_dir="/tmp/workspace",
        permission_mode="workspace_write",
        tools=[],
    )

    result = await agent.run_turn("Write the fix")

    assert result.response == "Stateless done"
    transport = agent._transport
    assert transport is not None
    prompt = transport.sent_messages[0]
    assert "System instructions:\nYou are a coder." in prompt
    assert "Assistant:\nEarlier answer" in prompt
    assert "User:\nWrite the fix" in prompt


@pytest.mark.asyncio
async def test_cli_executor_interrupts_active_transport_when_supported() -> None:
    channel = _CollectingChannel()
    executor = CliTransportExecutor(
        transport_adapter="tests.test_ravn.test_executor_cli.FakeResumableTransport"
    )
    agent = executor.build(
        channel=channel,
        system_prompt="You are a reviewer.",
        session=Session(),
        model="fake-model",
        max_iterations=3,
        checkpoint_port=None,
        task_id="task-3",
        persona="reviewer",
        workspace_dir="/tmp/workspace",
        permission_mode="read_only",
        tools=[],
    )

    await agent._ensure_transport()
    agent.interrupt(InterruptReason.SIGINT)
    await asyncio.sleep(0)

    transport = agent._transport
    assert transport is not None
    assert transport.control_calls == [("interrupt", {})]
    assert agent._interrupt_reason == InterruptReason.SIGINT
