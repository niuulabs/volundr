"""BifröstAdapter — LLM spec decomposition via Anthropic-compatible HTTP API.

Works with the Anthropic API directly, Bifröst gateway, or any
Anthropic-compatible endpoint (e.g. Ollama with Anthropic compat).
"""

from __future__ import annotations

import json
import logging

import httpx

from tyr.domain.models import SagaStructure
from tyr.domain.validation import ValidationError, parse_and_validate
from tyr.ports.llm import LLMPort

logger = logging.getLogger(__name__)

ANTHROPIC_API_VERSION = "2023-06-01"

DECOMPOSITION_PROMPT = """\
You are a saga decomposition engine for the Niuu platform.

Given a specification and repository, decompose the work into a structured saga \
with phases and raids.

## Rules

1. Each raid MUST be completable in a single Völundr session (2–6 hours estimated).
2. Raids estimated over 8 hours MUST be split into smaller raids.
3. `declared_files` MUST be non-empty — every raid must specify which files it touches.
4. `acceptance_criteria` MUST have at least one item per raid.
5. Raids that are too vague MUST be split into more specific sub-raids.
6. Self-score your confidence for each raid:
   - 1.0 = highly specific, well-bounded, clear acceptance criteria
   - 0.5 = moderate clarity, some ambiguity remains
   - 0.0 = vague, risky, or poorly scoped

## Output format

Respond with ONLY valid JSON (no markdown fences, no commentary). The schema:

{{
  "name": "<saga name>",
  "phases": [
    {{
      "name": "<phase name>",
      "raids": [
        {{
          "name": "<raid name>",
          "description": "<what this raid accomplishes>",
          "acceptance_criteria": ["<criterion 1>", ...],
          "declared_files": ["<file path 1>", ...],
          "estimate_hours": <float between 2 and 6>,
          "confidence": <float between 0.0 and 1.0>
        }}
      ]
    }}
  ]
}}

## Input

Repository: {repo}

Specification:
{spec}
"""

# HTTP status codes that trigger a retry (transient server/rate-limit errors).
_RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503})


class DecompositionError(Exception):
    """Raised when LLM decomposition fails after all retries."""


class BifrostAdapter(LLMPort):
    """Routes spec decomposition via an Anthropic-compatible Messages API.

    Works with the Anthropic API, Bifröst gateway, or any compatible endpoint.
    Constructor kwargs are forwarded from LLMConfig via the dynamic adapter pattern.
    """

    def __init__(
        self,
        *,
        base_url: str = "https://api.anthropic.com",
        api_key: str = "",
        timeout: float = 120.0,
        max_tokens: int = 8192,
        max_retries: int = 2,
        min_estimate_hours: float = 2.0,
        max_estimate_hours: float = 8.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._max_tokens = max_tokens
        self._max_retries = max_retries
        self._min_estimate_hours = min_estimate_hours
        self._max_estimate_hours = max_estimate_hours
        self._client = httpx.AsyncClient(timeout=timeout)

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {
            "anthropic-version": ANTHROPIC_API_VERSION,
            "content-type": "application/json",
        }
        if self._api_key:
            headers["x-api-key"] = self._api_key
        return headers

    async def decompose_spec(self, spec: str, repo: str, *, model: str) -> SagaStructure:
        prompt = DECOMPOSITION_PROMPT.format(spec=spec, repo=repo)
        last_error: Exception | None = None

        for attempt in range(1, self._max_retries + 1):
            try:
                raw = await self._call_api(prompt, model=model)
                return parse_and_validate(
                    raw,
                    min_estimate_hours=self._min_estimate_hours,
                    max_estimate_hours=self._max_estimate_hours,
                )
            except (json.JSONDecodeError, ValidationError) as exc:
                logger.warning(
                    "Decomposition attempt %d/%d failed: %s",
                    attempt,
                    self._max_retries,
                    exc,
                )
                last_error = exc
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in _RETRYABLE_STATUS_CODES:
                    raise
                logger.warning(
                    "Decomposition attempt %d/%d: HTTP %d",
                    attempt,
                    self._max_retries,
                    exc.response.status_code,
                )
                last_error = exc

        raise DecompositionError(
            f"Failed to decompose spec after {self._max_retries} attempts: {last_error}"
        )

    async def _call_api(self, prompt: str, *, model: str) -> str:
        """Call the Anthropic-compatible Messages API and return the raw text."""
        resp = await self._client.post(
            f"{self._base_url}/v1/messages",
            headers=self._headers(),
            json={
                "model": model,
                "max_tokens": self._max_tokens,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        resp.raise_for_status()
        data = resp.json()
        content_blocks = data.get("content", [])
        text_parts = [block["text"] for block in content_blocks if block.get("type") == "text"]
        return "".join(text_parts)

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()
