"""Core Ravn agent loop."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime
from typing import Any

from ravn.domain.events import RavnEvent, RavnEventType
from ravn.domain.exceptions import MaxIterationsError, PermissionDeniedError
from ravn.domain.models import (
    Episode,
    LLMResponse,
    Message,
    Outcome,
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
from ravn.ports.memory import MemoryPort
from ravn.ports.permission import PermissionPort
from ravn.ports.tool import ToolPort

logger = logging.getLogger(__name__)

# Hook type: async callable receiving the tool call and (for post) the result.
PreToolHook = Callable[[ToolCall], Coroutine[Any, Any, None]]
PostToolHook = Callable[[ToolCall, ToolResult], Coroutine[Any, Any, None]]

# Async callable that receives a question string and returns the user's answer.
UserInputFn = Callable[[str], Coroutine[Any, Any, str]]

_ASK_USER_TOOL_NAME = "ask_user"


class RavnAgent:
    """Turn-based agent that converses with an LLM and executes tools.

    The agent maintains a session (conversation history) and runs a loop
    for each user turn:
    1. Append the user message to history.
    2. Call the LLM (streaming).
    3. If the LLM requests tool calls, execute them (with permission check and hooks).
    4. Feed tool results back to the LLM and repeat from step 2.
    5. When the LLM returns a final response (stop_reason != tool_use), return.

    The ``ask_user`` tool is agent-intercepted: when the LLM calls it, the
    agent pauses the loop, emits the question to the channel, waits for the
    caller-supplied ``user_input_fn``, and injects the answer as a tool result.
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
        user_input_fn: UserInputFn | None = None,
        memory: MemoryPort | None = None,
        episode_summary_max_chars: int = 500,
        episode_task_max_chars: int = 200,
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
        self._user_input_fn = user_input_fn
        self._memory = memory
        self._episode_summary_max_chars = episode_summary_max_chars
        self._episode_task_max_chars = episode_task_max_chars
        self._session = Session()

    @property
    def session(self) -> Session:
        return self._session

    @property
    def tools(self) -> list[ToolPort]:
        """Return all registered tools in registration order."""
        return list(self._tools.values())

    @property
    def max_iterations(self) -> int:
        """Maximum tool-call iterations allowed per turn."""
        return self._max_iterations

    @property
    def llm_adapter_name(self) -> str:
        """Class name of the active LLM adapter."""
        return type(self._llm).__name__

    def _tool_defs(self) -> list[dict]:
        return [t.to_api_dict() for t in self._tools.values()]

    def _build_api_messages(self) -> list[dict]:
        """Convert session messages to the API format."""
        return [{"role": m.role, "content": m.content} for m in self._session.messages]

    async def run_turn(self, user_input: str) -> TurnResult:
        """Process one user turn and return the result.

        Runs the full tool-call loop until the LLM produces a final response
        or the maximum number of iterations is reached.

        If a memory adapter is configured:
        - Relevant past context is prefetched and appended to the system prompt.
        - A new episode is recorded after the turn completes.
        """
        # Prefetch memory context before appending the user message.
        effective_system = self._system_prompt
        if self._memory is not None:
            try:
                memory_ctx = await self._memory.prefetch(user_input)
                if memory_ctx:
                    effective_system = f"{self._system_prompt}\n\n{memory_ctx}"
            except Exception:
                logger.warning("Memory prefetch failed; continuing without context.")

        self._session.add_message(Message(role="user", content=user_input))

        turn_tool_calls: list[ToolCall] = []
        turn_tool_results: list[ToolResult] = []
        cumulative_usage = TokenUsage(input_tokens=0, output_tokens=0)
        final_response = ""

        for iteration in range(self._max_iterations):
            llm_response = await self._call_llm_streaming(system_prompt=effective_system)
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

        result = TurnResult(
            response=final_response,
            tool_calls=turn_tool_calls,
            tool_results=turn_tool_results,
            usage=cumulative_usage,
        )

        if self._memory is not None:
            try:
                episode = _extract_episode(
                    session_id=str(self._session.id),
                    user_input=user_input,
                    turn_result=result,
                    summary_max_chars=self._episode_summary_max_chars,
                    task_max_chars=self._episode_task_max_chars,
                )
                await self._memory.record_episode(episode)
            except Exception:
                logger.warning("Memory episode recording failed; continuing.")

        return result

    async def _call_llm_streaming(self, system_prompt: str | None = None) -> LLMResponse:
        """Call the LLM with streaming and accumulate into an LLMResponse."""
        accumulated_text = ""
        tool_calls: list[ToolCall] = []
        final_usage = TokenUsage(input_tokens=0, output_tokens=0)
        stop_reason = StopReason.END_TURN
        effective = system_prompt if system_prompt is not None else self._system_prompt

        async for event in self._llm.stream(
            self._build_api_messages(),
            tools=self._tool_defs(),
            system=effective,
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
        """Execute a single tool call, enforcing permissions and running hooks.

        The ``ask_user`` tool is intercepted before regular dispatch and
        handled by ``_intercept_ask_user`` regardless of whether it is
        present in the tools registry.
        """
        if tool_call.name == _ASK_USER_TOOL_NAME:
            return await self._intercept_ask_user(tool_call)

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

    async def _intercept_ask_user(self, tool_call: ToolCall) -> ToolResult:
        """Handle an ask_user tool call by collecting input from the user.

        Emits a TOOL_START event so channels can render the question, then
        calls ``user_input_fn`` if configured.  Returns an error result when
        no input function is available.
        """
        question = tool_call.input.get("question", "")
        await self._channel.emit(RavnEvent.tool_start(_ASK_USER_TOOL_NAME, tool_call.input))

        if self._user_input_fn is None:
            result = ToolResult(
                tool_call_id=tool_call.id,
                content="ask_user is not available in this session (no user_input_fn configured)",
                is_error=True,
            )
            await self._channel.emit(
                RavnEvent.tool_result(_ASK_USER_TOOL_NAME, result.content, is_error=True)
            )
            return result

        answer = await self._user_input_fn(question)
        result = ToolResult(tool_call_id=tool_call.id, content=answer)
        await self._channel.emit(RavnEvent.tool_result(_ASK_USER_TOOL_NAME, answer))
        return result


_TAG_MAP: dict[str, list[str]] = {
    "file": ["file_operations"],
    "write_file": ["file_operations"],
    "edit_file": ["file_operations"],
    "read_file": ["file_operations"],
    "search_files": ["file_operations"],
    "git": ["git"],
    "bash": ["shell"],
    "terminal": ["shell"],
    "web_search": ["web"],
    "web_fetch": ["web"],
    "session_search": ["memory"],
    "todo": ["task_management"],
}


def _infer_tags(tool_names: list[str]) -> list[str]:
    """Heuristically infer episode tags from the tools that were used."""
    tags: list[str] = []
    for name in tool_names:
        for key, tag_list in _TAG_MAP.items():
            if key in name.lower():
                for t in tag_list:
                    if t not in tags:
                        tags.append(t)
    if not tags:
        tags.append("general")
    return tags


def _determine_outcome(tool_results: list[ToolResult]) -> Outcome:
    """Determine episode outcome from tool results."""
    if not tool_results:
        return Outcome.SUCCESS
    errors = [r for r in tool_results if r.is_error]
    if len(errors) == len(tool_results):
        return Outcome.FAILURE
    if errors:
        return Outcome.PARTIAL
    return Outcome.SUCCESS


def _extract_episode(
    session_id: str,
    user_input: str,
    turn_result: TurnResult,
    *,
    summary_max_chars: int = 500,
    task_max_chars: int = 200,
) -> Episode:
    """Derive an Episode from a completed agent turn.

    Uses heuristics for tagging and outcome determination.  Embedding
    generation is deferred to Phase 3.5.
    """
    tools_used = list({tc.name for tc in turn_result.tool_calls})
    outcome = _determine_outcome(turn_result.tool_results)
    tags = _infer_tags(tools_used)

    summary = turn_result.response[:summary_max_chars]
    if len(turn_result.response) > summary_max_chars:
        summary = summary.rstrip() + "…"
    if not summary:
        summary = f"Completed task with {len(tools_used)} tool(s) used."

    task_description = user_input[:task_max_chars]
    if len(user_input) > task_max_chars:
        task_description = task_description.rstrip() + "…"

    return Episode(
        episode_id=str(uuid.uuid4()),
        session_id=session_id,
        timestamp=datetime.now(UTC),
        summary=summary,
        task_description=task_description,
        tools_used=tools_used,
        outcome=outcome,
        tags=tags,
        embedding=None,
    )


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
