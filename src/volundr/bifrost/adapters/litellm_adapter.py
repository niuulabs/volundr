"""LiteLLM upstream adapter — format-translating bridge for non-Anthropic providers.

Translates Anthropic Messages format ↔ OpenAI format using litellm as a
library.  Handles both streaming and non-streaming paths.

litellm is an optional dependency — import errors are caught at
construction time so the rest of Bifröst works without it.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from volundr.bifrost.config import UpstreamEntryConfig
from volundr.bifrost.ports import UpstreamProvider

logger = logging.getLogger(__name__)

try:
    import litellm

    litellm.suppress_debug_info = True
    litellm.drop_params = True
    HAS_LITELLM = True
except ImportError:
    HAS_LITELLM = False


class LiteLLMAdapter(UpstreamProvider):
    """Adapter for non-Anthropic upstreams via LiteLLM.

    Receives requests in Anthropic Messages format, translates to
    OpenAI format via LiteLLM, and translates responses back to
    Anthropic format.
    """

    def __init__(self, config: UpstreamEntryConfig) -> None:
        if not HAS_LITELLM:
            raise RuntimeError(
                "litellm is not installed.  Install with: pip install 'volundr[litellm]'"
            )
        self._config = config
        self._model_prefix = self._derive_model_prefix()

        # Set API key if configured
        resolved_key = config.auth.resolve_key()
        if resolved_key:
            self._api_key = resolved_key
        else:
            self._api_key = None

    def _derive_model_prefix(self) -> str:
        """Derive litellm model prefix from config URL."""
        url = self._config.url.lower()
        if "openai" in url:
            return ""
        if "localhost" in url or "127.0.0.1" in url:
            return "ollama/"
        return ""

    # ------------------------------------------------------------------
    # UpstreamProvider interface
    # ------------------------------------------------------------------

    async def forward(
        self,
        body: bytes,
        headers: dict[str, str],
    ) -> tuple[int, dict[str, str], bytes]:
        parsed = json.loads(body)
        openai_params = _anthropic_to_openai(parsed)
        model = self._resolve_model(openai_params.pop("model", "gpt-4o"))

        kwargs: dict[str, Any] = {
            "model": model,
            **openai_params,
            "stream": False,
        }
        if self._api_key:
            kwargs["api_key"] = self._api_key
        if self._config.url:
            kwargs["api_base"] = self._config.url

        try:
            response = await litellm.acompletion(**kwargs)
        except Exception as exc:
            logger.exception("LiteLLM upstream error")
            err_body = json.dumps(
                {
                    "type": "error",
                    "error": {
                        "type": "upstream_error",
                        "message": str(exc),
                    },
                }
            ).encode()
            return 502, {"content-type": "application/json"}, err_body

        anthropic_body = _openai_response_to_anthropic(response, parsed.get("model", "unknown"))
        resp_bytes = json.dumps(anthropic_body).encode()
        return 200, {"content-type": "application/json"}, resp_bytes

    async def stream_forward(
        self,
        body: bytes,
        headers: dict[str, str],
    ) -> tuple[int, dict[str, str], AsyncIterator[bytes]]:
        parsed = json.loads(body)
        openai_params = _anthropic_to_openai(parsed)
        model = self._resolve_model(openai_params.pop("model", "gpt-4o"))

        kwargs: dict[str, Any] = {
            "model": model,
            **openai_params,
            "stream": True,
        }
        if self._api_key:
            kwargs["api_key"] = self._api_key
        if self._config.url:
            kwargs["api_base"] = self._config.url

        try:
            response = await litellm.acompletion(**kwargs)
        except Exception as exc:
            logger.exception("LiteLLM upstream error (streaming)")
            err_body = json.dumps(
                {
                    "type": "error",
                    "error": {
                        "type": "upstream_error",
                        "message": str(exc),
                    },
                }
            ).encode()

            async def _err_iter() -> AsyncIterator[bytes]:
                yield err_body

            return 502, {"content-type": "application/json"}, _err_iter()

        resp_headers = {"content-type": "text/event-stream"}
        return (
            200,
            resp_headers,
            _stream_to_anthropic_sse(
                response,
                parsed.get("model", "unknown"),
            ),
        )

    async def close(self) -> None:
        pass

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _resolve_model(self, model: str) -> str:
        """Apply model prefix for litellm provider routing."""
        if self._model_prefix and not model.startswith(self._model_prefix):
            return f"{self._model_prefix}{model}"
        return model


# ------------------------------------------------------------------
# Anthropic → OpenAI translation
# ------------------------------------------------------------------


def _anthropic_to_openai(body: dict[str, Any]) -> dict[str, Any]:
    """Translate an Anthropic Messages request to OpenAI format."""
    messages: list[dict[str, Any]] = []

    # System prompt → system message
    system = body.get("system")
    if system:
        if isinstance(system, list):
            text = " ".join(b.get("text", "") for b in system if isinstance(b, dict))
        else:
            text = str(system)
        messages.append({"role": "system", "content": text})

    # Convert messages
    for msg in body.get("messages", []):
        converted = _convert_message(msg)
        messages.extend(converted)

    result: dict[str, Any] = {
        "model": body.get("model", "gpt-4o"),
        "messages": messages,
    }

    max_tokens = body.get("max_tokens")
    if max_tokens:
        result["max_tokens"] = max_tokens

    # Convert tools
    tools = body.get("tools")
    if tools:
        result["tools"] = [_convert_tool(t) for t in tools]

    # Temperature
    temp = body.get("temperature")
    if temp is not None:
        result["temperature"] = temp

    # Top-p
    top_p = body.get("top_p")
    if top_p is not None:
        result["top_p"] = top_p

    return result


def _convert_message(msg: dict[str, Any]) -> list[dict[str, Any]]:
    """Convert a single Anthropic message to OpenAI message(s)."""
    role = msg.get("role", "user")
    content = msg.get("content", "")

    if isinstance(content, str):
        return [{"role": role, "content": content}]

    if not isinstance(content, list):
        return [{"role": role, "content": str(content)}]

    # Content blocks — may produce multiple messages
    text_parts: list[str] = []
    tool_calls: list[dict[str, Any]] = []
    tool_results: list[dict[str, Any]] = []

    for block in content:
        if not isinstance(block, dict):
            continue

        block_type = block.get("type", "")

        if block_type == "text":
            text_parts.append(block.get("text", ""))

        elif block_type == "tool_use":
            tool_calls.append(
                {
                    "id": block.get("id", ""),
                    "type": "function",
                    "function": {
                        "name": block.get("name", ""),
                        "arguments": json.dumps(block.get("input", {})),
                    },
                }
            )

        elif block_type == "tool_result":
            result_content = block.get("content", "")
            if isinstance(result_content, list):
                result_content = " ".join(
                    b.get("text", "") for b in result_content if isinstance(b, dict)
                )
            tool_results.append(
                {
                    "role": "tool",
                    "tool_call_id": block.get("tool_use_id", ""),
                    "content": str(result_content),
                }
            )

    results: list[dict[str, Any]] = []

    # Assistant message with tool calls
    if role == "assistant" and tool_calls:
        assistant_msg: dict[str, Any] = {
            "role": "assistant",
            "tool_calls": tool_calls,
        }
        if text_parts:
            assistant_msg["content"] = "\n".join(text_parts)
        results.append(assistant_msg)

    elif text_parts:
        results.append({"role": role, "content": "\n".join(text_parts)})

    # Tool results become separate tool messages
    results.extend(tool_results)

    if not results:
        results.append({"role": role, "content": ""})

    return results


def _convert_tool(tool: dict[str, Any]) -> dict[str, Any]:
    """Convert an Anthropic tool definition to OpenAI format."""
    return {
        "type": "function",
        "function": {
            "name": tool.get("name", ""),
            "description": tool.get("description", ""),
            "parameters": tool.get("input_schema", {}),
        },
    }


# ------------------------------------------------------------------
# OpenAI → Anthropic response translation
# ------------------------------------------------------------------


def _openai_response_to_anthropic(
    response: Any,
    request_model: str,
) -> dict[str, Any]:
    """Translate an OpenAI completion response to Anthropic format."""
    choice = response.choices[0] if response.choices else None
    message = choice.message if choice else None

    content_blocks: list[dict[str, Any]] = []
    stop_reason = "end_turn"

    if message:
        # Text content
        if message.content:
            content_blocks.append(
                {
                    "type": "text",
                    "text": message.content,
                }
            )

        # Tool calls
        if message.tool_calls:
            stop_reason = "tool_use"
            for tc in message.tool_calls:
                try:
                    input_data = json.loads(tc.function.arguments)
                except (json.JSONDecodeError, AttributeError):
                    input_data = {}
                content_blocks.append(
                    {
                        "type": "tool_use",
                        "id": tc.id or "",
                        "name": tc.function.name or "",
                        "input": input_data,
                    }
                )

        # Finish reason mapping
        finish = choice.finish_reason if choice else None
        if finish == "stop":
            stop_reason = "end_turn"
        elif finish == "tool_calls":
            stop_reason = "tool_use"
        elif finish == "length":
            stop_reason = "max_tokens"

    if not content_blocks:
        content_blocks.append({"type": "text", "text": ""})

    usage = response.usage
    return {
        "id": response.id or "msg_litellm",
        "type": "message",
        "role": "assistant",
        "model": request_model,
        "content": content_blocks,
        "stop_reason": stop_reason,
        "usage": {
            "input_tokens": usage.prompt_tokens if usage else 0,
            "output_tokens": usage.completion_tokens if usage else 0,
        },
    }


# ------------------------------------------------------------------
# Streaming: OpenAI chunks → Anthropic SSE
# ------------------------------------------------------------------


async def _stream_to_anthropic_sse(
    response: Any,
    request_model: str,
) -> AsyncIterator[bytes]:
    """Translate OpenAI streaming chunks to Anthropic SSE events."""
    output_tokens = 0
    content_started = False
    tool_index = 0
    active_tool: dict[str, Any] | None = None
    accumulated_args = ""

    # message_start
    yield _sse_event(
        "message_start",
        {
            "type": "message_start",
            "message": {
                "id": "msg_litellm",
                "type": "message",
                "role": "assistant",
                "model": request_model,
                "usage": {"input_tokens": 0, "output_tokens": 0},
            },
        },
    )

    async for chunk in response:
        if not chunk.choices:
            # Usage-only chunk
            if hasattr(chunk, "usage") and chunk.usage:
                output_tokens = chunk.usage.completion_tokens or 0
            continue

        delta = chunk.choices[0].delta
        finish_reason = chunk.choices[0].finish_reason

        # Text content
        if delta and delta.content:
            if not content_started:
                yield _sse_event(
                    "content_block_start",
                    {
                        "type": "content_block_start",
                        "index": 0,
                        "content_block": {"type": "text", "text": ""},
                    },
                )
                content_started = True

            yield _sse_event(
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "text_delta", "text": delta.content},
                },
            )

        # Tool calls
        if delta and delta.tool_calls:
            for tc in delta.tool_calls:
                if tc.function and tc.function.name:
                    # New tool call starting
                    if active_tool and accumulated_args:
                        # Close previous tool
                        yield _sse_event(
                            "content_block_stop",
                            {
                                "type": "content_block_stop",
                                "index": tool_index,
                            },
                        )

                    tool_index = (tool_index + 1) if active_tool else (1 if content_started else 0)
                    active_tool = {
                        "id": tc.id or "",
                        "name": tc.function.name,
                    }
                    accumulated_args = ""

                    yield _sse_event(
                        "content_block_start",
                        {
                            "type": "content_block_start",
                            "index": tool_index,
                            "content_block": {
                                "type": "tool_use",
                                "id": active_tool["id"],
                                "name": active_tool["name"],
                                "input": {},
                            },
                        },
                    )

                if tc.function and tc.function.arguments:
                    accumulated_args += tc.function.arguments
                    yield _sse_event(
                        "content_block_delta",
                        {
                            "type": "content_block_delta",
                            "index": tool_index,
                            "delta": {
                                "type": "input_json_delta",
                                "partial_json": tc.function.arguments,
                            },
                        },
                    )

        # Finish
        if finish_reason:
            if content_started:
                yield _sse_event(
                    "content_block_stop",
                    {
                        "type": "content_block_stop",
                        "index": 0,
                    },
                )
            if active_tool:
                yield _sse_event(
                    "content_block_stop",
                    {
                        "type": "content_block_stop",
                        "index": tool_index,
                    },
                )

            stop = "end_turn"
            if finish_reason == "tool_calls":
                stop = "tool_use"
            elif finish_reason == "length":
                stop = "max_tokens"

            # Try to get final usage from chunk
            if hasattr(chunk, "usage") and chunk.usage:
                output_tokens = chunk.usage.completion_tokens or 0

            yield _sse_event(
                "message_delta",
                {
                    "type": "message_delta",
                    "delta": {"stop_reason": stop},
                    "usage": {"output_tokens": output_tokens},
                },
            )

    yield _sse_event("message_stop", {"type": "message_stop"})


def _sse_event(event: str, data: dict[str, Any]) -> bytes:
    """Format an SSE event."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()
