"""Core Ravn agent loop."""

from __future__ import annotations

import logging
from collections.abc import Callable, Coroutine
from typing import Any

from ravn.domain.events import RavnEvent, RavnEventType
from ravn.domain.exceptions import MaxIterationsError, PermissionDeniedError
from ravn.domain.models import (
    LLMResponse,
    Message,
    Session,
    StopReason,
    StreamEventType,
    TokenUsage,
    ToolCall,
    ToolResult,
    TurnResult,
)
from ravn.ports.channel import ChannelPort
from ravn.ports.llm import LLMPort
from ravn.ports.permission import PermissionPort
from ravn.ports.tool import ToolPort

logger = logging.getLogger(__name__)

# Hook type: async callable receiving the tool call and (for post) the result.
PreToolHook = Callable[[ToolCall], Coroutine[Any, Any, None]]
PostToolHook = Callable[[ToolCall, ToolResult], Coroutine[Any, Any, None]]


class RavnAgent:
    """Turn-based agent that converses with an LLM and executes tools.

    The agent maintains a session (conversation history) and runs a loop
    for each user turn:
    1. Append the user message to history.
    2. Call the LLM (streaming).
    3. If the LLM requests tool calls, execute them (with permission check and hooks).
    4. Feed tool results back to the LLM and repeat from step 2.
    5. When the LLM returns a final response (stop_reason != tool_use), return.
    """

    def __init__(
        self,
        llm: LLMPort,
        tools: list[ToolPort],
        channel: ChannelPort,
        permission: PermissionPort,
        *,
        system_prompt: str,
        model: str,
        max_tokens: int,
        max_iterations: int,
        pre_tool_hooks: list[PreToolHook] | None = None,
        post_tool_hooks: list[PostToolHook] | None = None,
    ) -> None:
        self._llm = llm
        self._tools = {t.name: t for t in tools}
        self._channel = channel
        self._permission = permission
        self._system_prompt = system_prompt
        self._model = model
        self._max_tokens = max_tokens
        self._max_iterations = max_iterations
        self._pre_tool_hooks: list[PreToolHook] = pre_tool_hooks or []
        self._post_tool_hooks: list[PostToolHook] = post_tool_hooks or []
        self._session = Session()

    @property
    def session(self) -> Session:
        return self._session

    def _tool_defs(self) -> list[dict]:
        return [t.to_api_dict() for t in self._tools.values()]

    def _build_api_messages(self) -> list[dict]:
        """Convert session messages to the API format."""
        return [{"role": m.role, "content": m.content} for m in self._session.messages]

    async def run_turn(self, user_input: str) -> TurnResult:
        """Process one user turn and return the result.

        Runs the full tool-call loop until the LLM produces a final response
        or the maximum number of iterations is reached.
        """
        self._session.add_message(Message(role="user", content=user_input))

        turn_tool_calls: list[ToolCall] = []
        turn_tool_results: list[ToolResult] = []
        cumulative_usage = TokenUsage(input_tokens=0, output_tokens=0)
        final_response = ""

        for iteration in range(self._max_iterations):
            llm_response = await self._call_llm_streaming()
            cumulative_usage = cumulative_usage + llm_response.usage

            if llm_response.content:
                await self._channel.emit(RavnEvent.response(llm_response.content))

            if llm_response.stop_reason != StopReason.TOOL_USE:
                final_response = llm_response.content
                self._session.add_message(Message(role="assistant", content=llm_response.content))
                break

            # Append the assistant message (with tool calls) to history.
            assistant_content = _build_assistant_content(llm_response)
            self._session.messages.append(Message(role="assistant", content=assistant_content))

            # Execute all tool calls sequentially.
            tool_results_content = []
            for tool_call in llm_response.tool_calls:
                turn_tool_calls.append(tool_call)
                result = await self._execute_tool(tool_call)
                turn_tool_results.append(result)
                tool_results_content.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_call.id,
                        "content": result.content,
                        "is_error": result.is_error,
                    }
                )

            # Append tool results as a user message.
            self._session.messages.append(Message(role="user", content=tool_results_content))
        else:
            raise MaxIterationsError(self._max_iterations)

        self._session.record_turn(cumulative_usage)

        return TurnResult(
            response=final_response,
            tool_calls=turn_tool_calls,
            tool_results=turn_tool_results,
            usage=cumulative_usage,
        )

    async def _call_llm_streaming(self) -> LLMResponse:
        """Call the LLM with streaming and accumulate into an LLMResponse."""
        accumulated_text = ""
        tool_calls: list[ToolCall] = []
        final_usage = TokenUsage(input_tokens=0, output_tokens=0)
        stop_reason = StopReason.END_TURN

        async for event in self._llm.stream(
            self._build_api_messages(),
            tools=self._tool_defs(),
            system=self._system_prompt,
            model=self._model,
            max_tokens=self._max_tokens,
        ):
            match event.type:
                case StreamEventType.TEXT_DELTA:
                    if event.text:
                        accumulated_text += event.text
                        await self._channel.emit(RavnEvent.thought(event.text))
                case StreamEventType.TOOL_CALL:
                    if event.tool_call:
                        tool_calls.append(event.tool_call)
                case StreamEventType.MESSAGE_DONE:
                    if event.usage:
                        final_usage = event.usage
                    if tool_calls:
                        stop_reason = StopReason.TOOL_USE

        return LLMResponse(
            content=accumulated_text,
            tool_calls=tool_calls,
            stop_reason=stop_reason,
            usage=final_usage,
        )

    async def _execute_tool(self, tool_call: ToolCall) -> ToolResult:
        """Execute a single tool call, enforcing permissions and running hooks."""
        tool = self._tools.get(tool_call.name)

        if tool is None:
            result = ToolResult(
                tool_call_id=tool_call.id,
                content=f"Unknown tool: {tool_call.name}",
                is_error=True,
            )
            await self._channel.emit(
                RavnEvent.tool_result(tool_call.name, result.content, is_error=True)
            )
            return result

        diff = tool.diff_preview(tool_call.input)
        await self._channel.emit(RavnEvent.tool_start(tool_call.name, tool_call.input, diff=diff))

        granted = await self._permission.check(tool.required_permission)
        if not granted:
            error = PermissionDeniedError(tool_call.name, tool.required_permission)
            result = ToolResult(
                tool_call_id=tool_call.id,
                content=str(error),
                is_error=True,
            )
            await self._channel.emit(
                RavnEvent.tool_result(tool_call.name, result.content, is_error=True)
            )
            return result

        for hook in self._pre_tool_hooks:
            await hook(tool_call)

        try:
            result = await tool.execute(tool_call.input)
        except Exception as exc:
            logger.warning("Tool '%s' raised: %s", tool_call.name, exc)
            result = ToolResult(
                tool_call_id=tool_call.id,
                content=f"Tool error: {exc}",
                is_error=True,
            )

        for hook in self._post_tool_hooks:
            await hook(tool_call, result)

        event_type = RavnEventType.TOOL_RESULT
        await self._channel.emit(
            RavnEvent(
                type=event_type,
                data=result.content,
                metadata={"tool_name": tool_call.name, "is_error": result.is_error},
            )
        )
        return result


def _build_assistant_content(response: LLMResponse) -> list[dict]:
    """Build the Anthropic-format assistant content list from an LLMResponse."""
    content: list[dict] = []

    if response.content:
        content.append({"type": "text", "text": response.content})

    for tc in response.tool_calls:
        content.append(
            {
                "type": "tool_use",
                "id": tc.id,
                "name": tc.name,
                "input": tc.input,
            }
        )

    return content
