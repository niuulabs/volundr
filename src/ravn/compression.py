"""Context compression for long Ravn sessions.

When a session's estimated token count exceeds a threshold (default 50% of the
model's context window), the ContextCompressor summarises the middle messages
using the LLM itself and replaces them with a synthetic summary message.

Protected regions
-----------------
- First *protect_first* messages are never touched (system context, initial
  instructions).
- Last *protect_last* messages are never touched (recent work in progress).

Multiple passes are allowed: compression repeats until the session falls below
the threshold or no further reduction is possible.

Compression statistics are returned in a ``CompressionResult`` so callers can
log, expose via events, or surface to the user.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ravn.budget import TokenEstimator
from ravn.domain.models import LLMResponse, Message
from ravn.ports.llm import LLMPort

logger = logging.getLogger(__name__)

_SUMMARY_SYSTEM = (
    "You are a concise conversation summariser.  Summarise the conversation "
    "accurately, preserving key decisions, actions taken, errors encountered, "
    "and important context.  Output only the summary text — no preamble, no "
    "markdown headers."
)

_SUMMARY_USER_TEMPLATE = "Summarise the following conversation segment concisely:\n\n{transcript}"

_SUMMARY_PLACEHOLDER = "[Conversation summary: {summary}]"

# Default context window sizes for well-known models.
_MODEL_CONTEXT_WINDOWS: dict[str, int] = {
    "claude-sonnet-4-6": 200_000,
    "claude-opus-4-6": 200_000,
    "claude-haiku-4-5-20251001": 200_000,
}
_DEFAULT_CONTEXT_WINDOW = 200_000


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class CompressionResult:
    """Describes what happened during a compression pass."""

    original_count: int
    final_count: int
    compression_count: int = 0
    removed_message_count: int = 0

    @property
    def was_compressed(self) -> bool:
        return self.compression_count > 0


# ---------------------------------------------------------------------------
# ContextCompressor
# ---------------------------------------------------------------------------


class ContextCompressor:
    """Compresses message history when it approaches the context window limit.

    Parameters
    ----------
    llm:
        LLM port used to generate compression summaries.
    model:
        Model identifier (used to look up context window size and for
        generating summaries).
    max_tokens:
        Max tokens for summary generation (default 1024).
    protect_first:
        Number of messages at the start of history to preserve unchanged.
    protect_last:
        Number of messages at the end of history to preserve unchanged.
    compression_threshold:
        Fraction of the model's context window that triggers compression
        (default 0.5 = 50%).
    context_window:
        Override context window size in tokens.  When 0 (default), the known
        table is consulted and falls back to 200 000.
    """

    def __init__(
        self,
        llm: LLMPort,
        *,
        model: str,
        max_tokens: int = 1024,
        protect_first: int = 2,
        protect_last: int = 4,
        compression_threshold: float = 0.5,
        context_window: int = 0,
    ) -> None:
        self._llm = llm
        self._model = model
        self._max_tokens = max_tokens
        self._protect_first = protect_first
        self._protect_last = protect_last
        self._threshold = compression_threshold
        window = context_window or _MODEL_CONTEXT_WINDOWS.get(model, _DEFAULT_CONTEXT_WINDOW)
        self._context_window = window

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    async def maybe_compress(
        self,
        messages: list[Message],
        *,
        system_tokens: int = 0,
    ) -> tuple[list[Message], CompressionResult]:
        """Compress *messages* if estimated tokens exceed the threshold.

        Returns the (possibly compressed) message list and a
        ``CompressionResult``.  When no compression was needed, the original
        list is returned unchanged.
        """
        original_count = len(messages)
        threshold_tokens = int(self._context_window * self._threshold)

        estimated = TokenEstimator.rough_messages(messages) + system_tokens
        if estimated <= threshold_tokens:
            return messages, CompressionResult(
                original_count=original_count, final_count=original_count
            )

        result_messages = messages
        compression_count = 0
        removed_count = 0

        while True:
            new_messages, removed = await self._compress_once(result_messages)
            if removed == 0:
                # Cannot compress further (protected zones cover everything).
                break
            compression_count += 1
            removed_count += removed
            result_messages = new_messages
            new_estimated = TokenEstimator.rough_messages(result_messages) + system_tokens
            if new_estimated <= threshold_tokens:
                break

        return result_messages, CompressionResult(
            original_count=original_count,
            final_count=len(result_messages),
            compression_count=compression_count,
            removed_message_count=removed_count,
        )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _compress_once(self, messages: list[Message]) -> tuple[list[Message], int]:
        """Run a single compression pass.

        Returns ``(new_messages, removed_count)``.  ``removed_count`` is 0
        when the protected zones leave no compressible middle section.
        """
        total = len(messages)
        protect_first = min(self._protect_first, total)
        protect_last = min(self._protect_last, max(0, total - protect_first))

        middle_start = protect_first
        middle_end = total - protect_last if protect_last > 0 else total
        middle = messages[middle_start:middle_end]

        if not middle:
            return messages, 0

        summary_text = await self._summarise(middle)
        summary_msg = Message(
            role="user",
            content=_SUMMARY_PLACEHOLDER.format(summary=summary_text),
        )

        head = messages[:protect_first]
        tail = messages[total - protect_last :] if protect_last > 0 else []
        # middle (len M) is replaced by 1 summary message → removed = M - 1
        removed = len(middle) - 1
        return head + [summary_msg] + tail, removed

    async def _summarise(self, messages: list[Message]) -> str:
        """Ask the LLM to summarise a list of messages."""
        transcript = _format_transcript(messages)
        user_text = _SUMMARY_USER_TEMPLATE.format(transcript=transcript)
        try:
            response: LLMResponse = await self._llm.generate(
                [{"role": "user", "content": user_text}],
                tools=[],
                system=_SUMMARY_SYSTEM,
                model=self._model,
                max_tokens=self._max_tokens,
            )
            return response.content.strip() or "[summary unavailable]"
        except Exception as exc:
            logger.warning("Compression summary failed: %s", exc)
            return "[summary unavailable]"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_content_text(content: str | list[dict]) -> str:
    """Extract plain text from a message content value."""
    if isinstance(content, str):
        return content
    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        block_type = block.get("type", "")
        match block_type:
            case "text":
                if block.get("text"):
                    parts.append(block["text"])
            case "tool_use":
                name = block.get("name", "?")
                inp = block.get("input", {})
                parts.append(f"[tool_call:{name} input={inp}]")
            case "tool_result":
                c = block.get("content", "")
                parts.append(f"[tool_result: {c}]")
            case _:
                pass
    return " ".join(parts)


def _format_transcript(messages: list[Message]) -> str:
    """Render messages to a plain-text transcript for the summary prompt."""
    lines: list[str] = []
    for msg in messages:
        text = _extract_content_text(msg.content)
        if text:
            lines.append(f"{msg.role.upper()}: {text}")
    return "\n\n".join(lines)
