"""AnthropicAdapter — LLMPort implementation using the Anthropic Messages API.

Uses httpx for HTTP, following the project pattern established in
tyr/adapters/bifrost.py.  Implements streaming (SSE), tool calling,
prompt caching (cache_control: ephemeral on system prompt), and
transient-error retries.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

import httpx

from ravn.domain.exceptions import LLMError
from ravn.domain.models import (
    LLMResponse,
    StopReason,
    StreamEvent,
    StreamEventType,
    TokenUsage,
    ToolCall,
)
from ravn.ports.llm import LLMPort

logger = logging.getLogger(__name__)

ANTHROPIC_API_VERSION = "2023-06-01"
ANTHROPIC_BETA_HEADER = "prompt-caching-2024-07-31"

_RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503})
_DEFAULT_BASE_URL = "https://api.anthropic.com"


class AnthropicAdapter(LLMPort):
    """Calls the Anthropic Messages API with streaming and tool support.

    Constructor kwargs are forwarded from config via the dynamic adapter pattern.
    """

    def __init__(
        self,
        *,
        api_key: str = "",
        base_url: str = _DEFAULT_BASE_URL,
        model: str = "claude-sonnet-4-6",
        max_tokens: int = 8192,
        max_retries: int = 3,
        retry_base_delay: float = 1.0,
        timeout: float = 120.0,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._default_model = model
        self._default_max_tokens = max_tokens
        self._max_retries = max_retries
        self._retry_base_delay = retry_base_delay
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self._api_key,
            "anthropic-version": ANTHROPIC_API_VERSION,
            "anthropic-beta": ANTHROPIC_BETA_HEADER,
            "content-type": "application/json",
        }

    def _build_system(self, system: str) -> list[dict]:
        """Wrap the system prompt with ephemeral cache control."""
        if not system:
            return []
        return [
            {
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }
        ]

    def _build_request(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: str,
        model: str,
        max_tokens: int,
        stream: bool,
    ) -> dict:
        body: dict = {
            "model": model or self._default_model,
            "max_tokens": max_tokens or self._default_max_tokens,
            "messages": messages,
            "stream": stream,
        }
        system_blocks = self._build_system(system)
        if system_blocks:
            body["system"] = system_blocks
        if tools:
            body["tools"] = tools
        return body

    async def _post_with_retry(
        self,
        client: httpx.AsyncClient,
        payload: dict,
        *,
        stream: bool,
    ) -> httpx.Response:
        url = f"{self._base_url}/v1/messages"
        last_exc: Exception | None = None

        for attempt in range(self._max_retries + 1):
            try:
                if stream:
                    response = await client.send(
                        client.build_request("POST", url, json=payload),
                        stream=True,
                    )
                else:
                    response = await client.post(url, json=payload)

                if response.status_code not in _RETRYABLE_STATUS_CODES:
                    return response

                if attempt < self._max_retries:
                    delay = self._retry_base_delay * (2**attempt)
                    logger.warning(
                        "Anthropic API returned %s, retrying in %.1fs (attempt %d/%d)",
                        response.status_code,
                        delay,
                        attempt + 1,
                        self._max_retries,
                    )
                    if stream:
                        await response.aclose()
                    await asyncio.sleep(delay)
                    last_exc = LLMError(
                        f"Anthropic API error {response.status_code}",
                        status_code=response.status_code,
                    )

            except httpx.TransportError as exc:
                last_exc = exc
                if attempt < self._max_retries:
                    delay = self._retry_base_delay * (2**attempt)
                    await asyncio.sleep(delay)

        raise LLMError(f"Anthropic API failed after {self._max_retries} retries") from last_exc

    async def stream(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: str,
        model: str,
        max_tokens: int,
    ) -> AsyncIterator[StreamEvent]:
        payload = self._build_request(
            messages,
            tools=tools,
            system=system,
            model=model,
            max_tokens=max_tokens,
            stream=True,
        )

        async with httpx.AsyncClient(headers=self._headers(), timeout=self._timeout) as client:
            response = await self._post_with_retry(client, payload, stream=True)

            if response.status_code != 200:
                body = await response.aread()
                raise LLMError(
                    f"Anthropic API error {response.status_code}: {body.decode()}",
                    status_code=response.status_code,
                )

            # Accumulate partial tool inputs keyed by tool_use block index.
            partial_inputs: dict[int, dict] = {}
            tool_ids: dict[int, str] = {}
            tool_names: dict[int, str] = {}
            current_block_index = -1

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                raw = line[len("data: ") :]
                if raw == "[DONE]":
                    break

                try:
                    event_data = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                event_type = event_data.get("type", "")

                match event_type:
                    case "content_block_start":
                        block = event_data.get("content_block", {})
                        current_block_index = event_data.get("index", current_block_index)
                        if block.get("type") == "tool_use":
                            tool_ids[current_block_index] = block.get("id", "")
                            tool_names[current_block_index] = block.get("name", "")
                            partial_inputs[current_block_index] = {}

                    case "content_block_delta":
                        delta = event_data.get("delta", {})
                        idx = event_data.get("index", current_block_index)
                        match delta.get("type"):
                            case "text_delta":
                                yield StreamEvent(
                                    type=StreamEventType.TEXT_DELTA,
                                    text=delta.get("text", ""),
                                )
                            case "input_json_delta":
                                # Accumulate partial JSON — emit when block stops.
                                if idx not in partial_inputs:
                                    partial_inputs[idx] = {}
                                chunk = delta.get("partial_json", "")
                                partial_inputs[idx]["_raw"] = (
                                    partial_inputs[idx].get("_raw", "") + chunk
                                )

                    case "content_block_stop":
                        idx = event_data.get("index", current_block_index)
                        if idx in partial_inputs:
                            raw_json = partial_inputs[idx].get("_raw", "")
                            try:
                                parsed_input = json.loads(raw_json) if raw_json else {}
                            except json.JSONDecodeError:
                                parsed_input = {}
                            yield StreamEvent(
                                type=StreamEventType.TOOL_CALL,
                                tool_call=ToolCall(
                                    id=tool_ids.get(idx, ""),
                                    name=tool_names.get(idx, ""),
                                    input=parsed_input,
                                ),
                            )
                            del partial_inputs[idx]

                    case "message_delta":
                        usage_data = event_data.get("usage", {})
                        yield StreamEvent(
                            type=StreamEventType.MESSAGE_DONE,
                            usage=TokenUsage(
                                input_tokens=usage_data.get("input_tokens", 0),
                                output_tokens=usage_data.get("output_tokens", 0),
                                cache_read_tokens=usage_data.get("cache_read_input_tokens", 0),
                                cache_write_tokens=usage_data.get("cache_creation_input_tokens", 0),
                            ),
                        )

    async def generate(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: str,
        model: str,
        max_tokens: int,
    ) -> LLMResponse:
        payload = self._build_request(
            messages,
            tools=tools,
            system=system,
            model=model,
            max_tokens=max_tokens,
            stream=False,
        )

        async with httpx.AsyncClient(headers=self._headers(), timeout=self._timeout) as client:
            response = await self._post_with_retry(client, payload, stream=False)

        if response.status_code != 200:
            raise LLMError(
                f"Anthropic API error {response.status_code}: {response.text}",
                status_code=response.status_code,
            )

        data = response.json()
        content_text = ""
        tool_calls: list[ToolCall] = []

        for block in data.get("content", []):
            match block.get("type"):
                case "text":
                    content_text += block.get("text", "")
                case "tool_use":
                    tool_calls.append(
                        ToolCall(
                            id=block.get("id", ""),
                            name=block.get("name", ""),
                            input=block.get("input", {}),
                        )
                    )

        usage_data = data.get("usage", {})
        stop_reason_raw = data.get("stop_reason", "end_turn")
        try:
            stop_reason = StopReason(stop_reason_raw)
        except ValueError:
            stop_reason = StopReason.END_TURN

        return LLMResponse(
            content=content_text,
            tool_calls=tool_calls,
            stop_reason=stop_reason,
            usage=TokenUsage(
                input_tokens=usage_data.get("input_tokens", 0),
                output_tokens=usage_data.get("output_tokens", 0),
                cache_read_tokens=usage_data.get("cache_read_input_tokens", 0),
                cache_write_tokens=usage_data.get("cache_creation_input_tokens", 0),
            ),
        )
