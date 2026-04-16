"""Thin in-process ravn dispatcher for single-turn agent calls.

Runs a single LLM turn with a persona's system prompt and parses the
``---outcome---`` block from the response.  No DriveLoop, no mesh, no
discovery — just a persona, an initiative context, and one turn.

Used by ReviewEngine (review-arbiter) and BifrostAdapter (decomposer).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from niuu.domain.outcome import OutcomeSchema, parse_outcome_block
from ravn.adapters.personas.loader import PersonaConfig, PersonaLoader

logger = logging.getLogger(__name__)

ANTHROPIC_API_VERSION = "2023-06-01"


class DispatchError(Exception):
    """Raised when the dispatcher cannot produce a valid outcome."""


class RavnDispatcher:
    """Single-turn in-process ravn dispatcher.

    Loads a persona by name, builds a prompt from the persona's system
    prompt template plus the supplied initiative context, makes one
    Anthropic-compatible API call, and returns the parsed outcome fields.

    Parameters
    ----------
    base_url:
        Anthropic-compatible endpoint (default: ``https://api.anthropic.com``).
    api_key:
        API key forwarded as ``x-api-key``.
    model:
        Default model; callers may override per-dispatch.
    timeout:
        HTTP timeout in seconds.
    max_tokens:
        Maximum tokens for the LLM response.
    persona_loader:
        Loader used to resolve persona configs.  When ``None`` the default
        :class:`~ravn.adapters.personas.loader.PersonaLoader` is used.
    """

    def __init__(
        self,
        *,
        base_url: str = "https://api.anthropic.com",
        api_key: str = "",
        model: str = "claude-sonnet-4-6",
        timeout: float = 60.0,
        max_tokens: int = 4096,
        persona_loader: PersonaLoader | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._max_tokens = max_tokens
        self._client = httpx.AsyncClient(timeout=timeout)
        self._loader = persona_loader or PersonaLoader()

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    def load_persona(self, name: str) -> PersonaConfig | None:
        """Return a persona config by name, or ``None`` if not found."""
        return self._loader.load(name)

    async def dispatch(
        self,
        persona_name: str,
        initiative_context: str,
        *,
        model: str | None = None,
    ) -> dict[str, Any] | None:
        """Run a single LLM turn for the named persona.

        Loads the persona, prepends its system prompt, sends the
        *initiative_context* as the user message, and parses the
        ``---outcome---`` block from the response.

        Parameters
        ----------
        persona_name:
            Name of the persona to load (e.g. ``"review-arbiter"``).
        initiative_context:
            The user-facing context string passed to the agent.
        model:
            Override the default model for this dispatch.

        Returns
        -------
        dict | None
            Parsed outcome fields on success.  ``None`` when the persona
            cannot be loaded, the API call fails, or no outcome block is
            present.
        """
        persona = self._loader.load(persona_name)
        if persona is None:
            logger.warning("RavnDispatcher: persona %r not found", persona_name)
            return None

        schema: OutcomeSchema | None = None
        if persona.produces.schema:
            schema = OutcomeSchema(fields=persona.produces.schema)

        system_prompt = persona.system_prompt_template.strip()
        used_model = model or self._model

        try:
            response_text = await self._call_llm(
                system_prompt=system_prompt,
                user_message=initiative_context,
                model=used_model,
            )
        except Exception:
            logger.warning(
                "RavnDispatcher: LLM call failed for persona %r",
                persona_name,
                exc_info=True,
            )
            return None

        outcome = parse_outcome_block(response_text, schema=schema)
        if outcome is None:
            logger.warning(
                "RavnDispatcher: no ---outcome--- block in response for persona %r",
                persona_name,
            )
            return None

        if not outcome.valid:
            logger.warning(
                "RavnDispatcher: invalid outcome for persona %r: %s",
                persona_name,
                outcome.errors,
            )
            return None

        return outcome.fields

    async def _call_llm(
        self,
        *,
        system_prompt: str,
        user_message: str,
        model: str,
    ) -> str:
        """Make a single Anthropic-compatible Messages API call.

        Returns the text content of the response.
        """
        headers: dict[str, str] = {
            "anthropic-version": ANTHROPIC_API_VERSION,
            "content-type": "application/json",
        }
        if self._api_key:
            headers["x-api-key"] = self._api_key

        payload: dict[str, Any] = {
            "model": model,
            "max_tokens": self._max_tokens,
            "messages": [{"role": "user", "content": user_message}],
        }
        if system_prompt:
            payload["system"] = system_prompt

        resp = await self._client.post(
            f"{self._base_url}/v1/messages",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()

        data = resp.json()
        content_blocks = data.get("content", [])
        text_parts = [b["text"] for b in content_blocks if b.get("type") == "text"]
        return "".join(text_parts)
