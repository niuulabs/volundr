"""Ollama provider adapter.

Ollama exposes an OpenAI-compatible Chat Completions API but has a few quirks:
- Base URL defaults to http://localhost:11434
- No API key required (uses empty Bearer token or none)
- Model names use ``name:tag`` format (e.g. ``llama3.1:8b``)
- Does not support ``top_p`` in some versions — we strip it defensively

For all other behaviour this inherits from ``OpenAICompatAdapter``.
"""

from __future__ import annotations

from bifrost.adapters.openai_compat import OpenAICompatAdapter
from bifrost.translation.models import AnthropicRequest

_OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434"


class OllamaAdapter(OpenAICompatAdapter):
    """Provider adapter for local Ollama instances."""

    def __init__(
        self,
        *,
        base_url: str = _OLLAMA_DEFAULT_BASE_URL,
        api_key: str = "",
        timeout: float = 300.0,
    ) -> None:
        super().__init__(base_url=base_url, api_key=api_key, timeout=timeout)

    def _completions_url(self) -> str:
        # Ollama's OpenAI-compatible endpoint.
        return f"{self._base_url}/v1/chat/completions"

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"content-type": "application/json"}
        # Ollama accepts an empty Bearer token when no key is configured.
        if self._api_key:
            headers["authorization"] = f"Bearer {self._api_key}"
        return headers

    def _strip_unsupported(self, payload: dict) -> dict:
        """Remove fields that some Ollama versions do not support."""
        payload.pop("top_p", None)
        return payload

    async def complete(self, request: AnthropicRequest, model: str) -> object:
        from bifrost.translation.to_anthropic import openai_to_anthropic
        from bifrost.translation.to_openai import anthropic_to_openai

        payload = anthropic_to_openai(request, model)
        payload["stream"] = False
        payload = self._strip_unsupported(payload)

        resp = await self._client.post(
            self._completions_url(),
            headers=self._headers(),
            json=payload,
        )
        resp.raise_for_status()
        return openai_to_anthropic(resp.json(), model)
