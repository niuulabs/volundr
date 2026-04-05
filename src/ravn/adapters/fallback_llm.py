"""FallbackLLMAdapter — multi-provider LLM with automatic fallback.

Tries providers in order.  On LLMError the next provider is attempted.
If all providers fail, AllProvidersExhaustedError is raised.

Restoration: each call starts from the primary (index 0) — there is no
sticky fallback state between turns.

Example config::

    llm:
      provider:
        adapter: ravn.adapters.anthropic_adapter.AnthropicAdapter
        kwargs: {api_key: "sk-ant-..."}
      fallbacks:
        - adapter: ravn.adapters.openai_llm.OpenAICompatibleAdapter
          kwargs: {base_url: "https://api.openai.com", api_key: "sk-..."}
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from ravn.domain.exceptions import AllProvidersExhaustedError, LLMError
from ravn.domain.models import LLMResponse, StreamEvent
from ravn.ports.llm import LLMPort, SystemPrompt

logger = logging.getLogger(__name__)


class FallbackLLMAdapter(LLMPort):
    """LLM adapter that tries a chain of providers, falling back on LLMError.

    The *providers* list must have at least one entry.  The first entry is the
    primary; the remainder are fallbacks tried in order.

    After any call (success or failure) the next call always starts from the
    primary — no sticky fallback state is kept between turns.
    """

    def __init__(self, providers: list[LLMPort]) -> None:
        if not providers:
            raise ValueError("FallbackLLMAdapter requires at least one provider")
        self._providers = providers

    @property
    def provider_count(self) -> int:
        """Number of providers in the chain (primary + fallbacks)."""
        return len(self._providers)

    async def generate(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: SystemPrompt,
        model: str,
        max_tokens: int,
        thinking: dict | None = None,
    ) -> LLMResponse:
        last_exc: Exception | None = None

        for idx, provider in enumerate(self._providers):
            # Pass thinking only when the provider supports it; skip silently otherwise.
            effective_thinking = thinking if provider.supports_thinking else None
            try:
                return await provider.generate(
                    messages,
                    tools=tools,
                    system=system,
                    model=model,
                    max_tokens=max_tokens,
                    thinking=effective_thinking,
                )
            except LLMError as exc:
                label = "primary" if idx == 0 else f"fallback[{idx}]"
                logger.warning(
                    "LLM %s (%s) failed with %s: %s — trying next provider",
                    label,
                    type(provider).__name__,
                    type(exc).__name__,
                    exc,
                )
                last_exc = exc

        raise AllProvidersExhaustedError(
            provider_count=len(self._providers),
            last_error=last_exc,
        ) from last_exc

    async def stream(
        self,
        messages: list[dict],
        *,
        tools: list[dict],
        system: SystemPrompt,
        model: str,
        max_tokens: int,
        thinking: dict | None = None,
    ) -> AsyncIterator[StreamEvent]:
        last_exc: Exception | None = None

        for idx, provider in enumerate(self._providers):
            # Pass thinking only when the provider supports it; skip silently otherwise.
            effective_thinking = thinking if provider.supports_thinking else None
            try:
                async for event in provider.stream(
                    messages,
                    tools=tools,
                    system=system,
                    model=model,
                    max_tokens=max_tokens,
                    thinking=effective_thinking,
                ):
                    yield event
                return
            except LLMError as exc:
                label = "primary" if idx == 0 else f"fallback[{idx}]"
                logger.warning(
                    "LLM %s (%s) failed with %s: %s — trying next provider",
                    label,
                    type(provider).__name__,
                    type(exc).__name__,
                    exc,
                )
                last_exc = exc

        raise AllProvidersExhaustedError(
            provider_count=len(self._providers),
            last_error=last_exc,
        ) from last_exc
