"""Sjón enrichment adapter — classifies Mímir pages as threads or facts.

For every newly ingested Mímir page, the enrichment adapter calls a cheap
LLM to decide:

1. Is this page *unfinished business* (an open question, half-explored idea,
   or topic that deserves follow-up)?  → thread
2. Or is it a settled fact / reference material?  → fact (ignored here)

If the page is a thread, :meth:`SjonEnrichmentAdapter.enrich` creates a
:class:`~ravn.domain.thread.RavnThread`, persists it via the
:class:`~ravn.ports.thread.ThreadPort`, and returns it.  Otherwise it returns
``None`` — no side-effects.

The LLM response is a minimal JSON object::

    {
      "is_thread": true,
      "importance": 0.8,
      "next_action": "read and extract key claims",
      "tags": ["paper", "ml"]
    }

``importance`` is in (0, 1] and is used as ``importance_factor`` when
computing the initial composite weight.
"""

from __future__ import annotations

import json
import logging
import re

from niuu.domain.mimir import MimirPage
from ravn.domain.thread import RavnThread, compute_weight
from ravn.ports.llm import LLMPort
from ravn.ports.thread import ThreadPort

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are Sjón, a classification assistant.  Given a Mímir wiki page you decide
whether the page represents *unfinished business* for the AI agent Ravn.

Unfinished business includes:
- Open questions or hypotheses that have not been fully explored
- Research papers whose implications have not been analysed
- Topics the agent should follow up on
- Half-formed ideas that deserve deeper thought
- Observations that raise questions

Settled facts, reference material, how-to guides, and completed summaries are
NOT unfinished business.

Respond with a JSON object and nothing else:
{
  "is_thread": <true|false>,
  "importance": <float 0.1-1.0>,
  "next_action": "<one-sentence hint for the agent, or empty string>",
  "tags": ["<tag1>", "<tag2>"]
}

importance 1.0 = highest priority; 0.1 = lowest.
next_action should be ≤ 80 characters.
tags should be short lowercase labels (2-4 tags max).
"""


class SjonEnrichmentAdapter:
    """Classifies a Mímir page as a thread or a fact.

    Parameters
    ----------
    llm:
        LLM adapter used for the classification call.
    thread_store:
        ThreadPort implementation that receives new threads.
    enrichment_model:
        Model alias passed to the LLM for the cheap classification call.
    enrichment_max_tokens:
        Maximum tokens in the LLM response.
    decay_half_life_days:
        Half-life for the recency decay applied to the initial weight.
    initial_weight:
        Base score used when ``importance`` is not provided by the LLM.
    """

    def __init__(
        self,
        llm: LLMPort,
        thread_store: ThreadPort,
        *,
        enrichment_model: str = "claude-haiku-4-5-20251001",
        enrichment_max_tokens: int = 256,
        decay_half_life_days: float = 7.0,
        initial_weight: float = 0.5,
    ) -> None:
        self._llm = llm
        self._store = thread_store
        self._model = enrichment_model
        self._max_tokens = enrichment_max_tokens
        self._half_life = decay_half_life_days
        self._initial_weight = initial_weight

    async def enrich(self, page: MimirPage) -> RavnThread | None:
        """Classify *page* and create a thread if it is unfinished business.

        Returns the persisted :class:`~ravn.domain.thread.RavnThread` if the
        page was classified as a thread, or ``None`` if it is a fact.
        """
        classification = await self._classify(page)
        if not classification.get("is_thread"):
            return None

        importance = float(classification.get("importance") or 1.0)
        importance = max(0.01, min(1.0, importance))
        next_action = str(classification.get("next_action") or "")
        tags = list(classification.get("tags") or [])

        tw = compute_weight(
            base_score=self._initial_weight,
            importance_factor=importance,
            created_at=page.meta.updated_at,
            half_life_days=self._half_life,
        )

        thread = RavnThread.create(
            page_path=page.meta.path,
            title=page.meta.title,
            weight=tw.composite,
            next_action=next_action,
            tags=tags,
        )
        await self._store.upsert(thread)
        logger.info(
            "Sjón: thread created for %s (weight=%.3f, action=%r)",
            page.meta.path,
            thread.weight,
            next_action,
        )
        return thread

    async def _classify(self, page: MimirPage) -> dict:
        """Call the LLM and return the parsed classification dict."""
        user_content = (
            f"Page path: {page.meta.path}\n"
            f"Title: {page.meta.title}\n"
            f"Summary: {page.meta.summary}\n\n"
            f"Content (truncated to 800 chars):\n{page.content[:800]}"
        )
        messages = [{"role": "user", "content": user_content}]
        try:
            response = await self._llm.generate(
                messages,
                tools=[],
                system=_SYSTEM_PROMPT,
                model=self._model,
                max_tokens=self._max_tokens,
            )
            raw = response.content.strip()
            return _parse_json(raw)
        except Exception:
            logger.warning(
                "Sjón: LLM classification failed for %s, defaulting to fact",
                page.meta.path,
                exc_info=True,
            )
            return {"is_thread": False}


def _parse_json(raw: str) -> dict:
    """Extract the first JSON object from *raw*, tolerating markdown fences."""
    # Strip code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
    raw = raw.strip()
    try:
        result = json.loads(raw)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass
    # Try to find a JSON object inside the string
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            result = json.loads(match.group(0))
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass
    return {"is_thread": False}
