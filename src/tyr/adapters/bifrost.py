"""BifröstAdapter — LLM spec decomposition via Bifröst HTTP API."""

from __future__ import annotations

import json
import logging

import httpx

from tyr.domain.models import PhaseSpec, RaidSpec, SagaStructure
from tyr.ports.llm import LLMPort

logger = logging.getLogger(__name__)

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

MIN_ESTIMATE_HOURS = 2.0
MAX_ESTIMATE_HOURS = 8.0


class DecompositionError(Exception):
    """Raised when LLM decomposition fails after all retries."""


class BifrostAdapter(LLMPort):
    """Routes spec decomposition to a configured model via Bifröst HTTP API."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 120.0,
        max_tokens: int = 8192,
        max_retries: int = 2,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._max_tokens = max_tokens
        self._max_retries = max_retries

    async def decompose_spec(self, spec: str, repo: str, *, model: str) -> SagaStructure:
        prompt = DECOMPOSITION_PROMPT.format(spec=spec, repo=repo)
        last_error: Exception | None = None

        for attempt in range(1, self._max_retries + 1):
            try:
                raw = await self._call_bifrost(prompt, model=model)
                return _parse_and_validate(raw)
            except (json.JSONDecodeError, ValidationError) as exc:
                logger.warning(
                    "Decomposition attempt %d/%d failed: %s",
                    attempt,
                    self._max_retries,
                    exc,
                )
                last_error = exc

        raise DecompositionError(
            f"Failed to decompose spec after {self._max_retries} attempts: {last_error}"
        )

    async def _call_bifrost(self, prompt: str, *, model: str) -> str:
        """Call Bifröst HTTP API and return the raw response text."""
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/api/v1/messages",
                json={
                    "model": model,
                    "max_tokens": self._max_tokens,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            # Bifröst returns Anthropic-style response with content blocks
            content_blocks = data.get("content", [])
            text_parts = [block["text"] for block in content_blocks if block.get("type") == "text"]
            return "".join(text_parts)


class ValidationError(Exception):
    """Raised when LLM output fails structural validation."""


def _parse_and_validate(raw: str) -> SagaStructure:
    """Parse raw JSON string and validate against SagaStructure schema."""
    # Strip markdown fences if LLM included them despite instructions
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        first_newline = cleaned.index("\n")
        cleaned = cleaned[first_newline + 1 :]
    if cleaned.endswith("```"):
        cleaned = cleaned[: cleaned.rfind("```")]
    cleaned = cleaned.strip()

    data = json.loads(cleaned)

    if not isinstance(data, dict):
        raise ValidationError("Response must be a JSON object")

    name = data.get("name")
    if not name or not isinstance(name, str):
        raise ValidationError("Missing or invalid 'name' field")

    phases_raw = data.get("phases")
    if not isinstance(phases_raw, list) or not phases_raw:
        raise ValidationError("'phases' must be a non-empty list")

    phases: list[PhaseSpec] = []
    for pi, phase_data in enumerate(phases_raw):
        if not isinstance(phase_data, dict):
            raise ValidationError(f"Phase {pi} must be an object")

        phase_name = phase_data.get("name")
        if not phase_name or not isinstance(phase_name, str):
            raise ValidationError(f"Phase {pi}: missing or invalid 'name'")

        raids_raw = phase_data.get("raids")
        if not isinstance(raids_raw, list) or not raids_raw:
            raise ValidationError(f"Phase '{phase_name}': 'raids' must be a non-empty list")

        raids: list[RaidSpec] = []
        for ri, raid_data in enumerate(raids_raw):
            raids.append(_validate_raid(raid_data, phase_name, ri))

        phases.append(PhaseSpec(name=phase_name, raids=raids))

    return SagaStructure(name=name, phases=phases)


def _validate_raid(data: object, phase_name: str, index: int) -> RaidSpec:
    """Validate a single raid dict and return a RaidSpec."""
    prefix = f"Phase '{phase_name}', raid {index}"

    if not isinstance(data, dict):
        raise ValidationError(f"{prefix}: must be an object")

    raid_name = data.get("name")
    if not raid_name or not isinstance(raid_name, str):
        raise ValidationError(f"{prefix}: missing or invalid 'name'")

    description = data.get("description")
    if not description or not isinstance(description, str):
        raise ValidationError(f"{prefix}: missing or invalid 'description'")

    criteria = data.get("acceptance_criteria")
    if not isinstance(criteria, list) or not criteria:
        raise ValidationError(f"{prefix}: 'acceptance_criteria' must be a non-empty list")
    for ci, c in enumerate(criteria):
        if not isinstance(c, str) or not c.strip():
            raise ValidationError(f"{prefix}: acceptance_criteria[{ci}] must be a non-empty string")

    files = data.get("declared_files")
    if not isinstance(files, list) or not files:
        raise ValidationError(f"{prefix}: 'declared_files' must be a non-empty list")
    for fi, f in enumerate(files):
        if not isinstance(f, str) or not f.strip():
            raise ValidationError(f"{prefix}: declared_files[{fi}] must be a non-empty string")

    estimate = data.get("estimate_hours")
    if not isinstance(estimate, (int, float)):
        raise ValidationError(f"{prefix}: 'estimate_hours' must be a number")
    estimate = float(estimate)
    if estimate < MIN_ESTIMATE_HOURS:
        raise ValidationError(
            f"{prefix}: estimate_hours {estimate} below minimum {MIN_ESTIMATE_HOURS}"
        )
    if estimate > MAX_ESTIMATE_HOURS:
        raise ValidationError(
            f"{prefix}: estimate_hours {estimate} exceeds maximum {MAX_ESTIMATE_HOURS}"
        )

    confidence = data.get("confidence")
    if not isinstance(confidence, (int, float)):
        raise ValidationError(f"{prefix}: 'confidence' must be a number")
    confidence = float(confidence)
    if confidence < 0.0 or confidence > 1.0:
        raise ValidationError(f"{prefix}: confidence must be between 0.0 and 1.0")

    return RaidSpec(
        name=raid_name,
        description=description,
        acceptance_criteria=criteria,
        declared_files=files,
        estimate_hours=estimate,
        confidence=confidence,
    )
