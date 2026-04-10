"""Thread domain models for Vaka wakefulness (NIU-555).

A *thread* is a Mímir page that represents unfinished business — an open
question, a half-explored idea, or a topic that deserves follow-up.  Not all
Mímir pages are threads; the Sjón enrichment step decides which ones qualify
and assigns them an initial weight and a next-action hint.

Threads are NOT a separate knowledge store.  They are metadata stored in a
``ravn_threads`` table that references Mímir pages by path.  The Mímir service
itself is unchanged.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from uuid import uuid4

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ThreadStatus(StrEnum):
    OPEN = "open"
    CLOSED = "closed"  # resolved / no longer relevant


# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------


@dataclass
class RavnThread:
    """A single thread — a Mímir page tagged as unfinished business.

    Parameters
    ----------
    thread_id:
        UUID string, generated at creation time.
    page_path:
        Relative path of the Mímir page, e.g. ``papers/attention.md``.
    title:
        Human-readable title copied from the Mímir page.
    weight:
        Current composite weight (≥ 0).  Higher means more urgent / relevant.
        Decays over time via :func:`compute_weight`.
    next_action:
        LLM-assigned hint describing what Ravn should do with this thread,
        e.g. ``"read and summarise the implications"``.
    tags:
        Arbitrary labels for filtering, e.g. ``["paper", "ml"]``.
    status:
        ``open`` (active) or ``closed`` (resolved).
    created_at:
        When this thread was first created.
    last_seen_at:
        When this thread was last touched (enriched, queued, or actioned).
    """

    thread_id: str
    page_path: str
    title: str
    weight: float
    next_action: str
    tags: list[str]
    status: ThreadStatus
    created_at: datetime
    last_seen_at: datetime

    @classmethod
    def create(
        cls,
        page_path: str,
        title: str,
        weight: float,
        next_action: str,
        tags: list[str] | None = None,
    ) -> RavnThread:
        """Convenience constructor — generates a UUID and timestamps now."""
        now = datetime.now(UTC)
        return cls(
            thread_id=str(uuid4()),
            page_path=page_path,
            title=title,
            weight=weight,
            next_action=next_action,
            tags=tags or [],
            status=ThreadStatus.OPEN,
            created_at=now,
            last_seen_at=now,
        )


@dataclass(frozen=True)
class ThreadWeight:
    """Decomposed weight factors for a thread.

    The composite weight is computed as::

        composite = base_score * recency_factor * importance_factor

    where ``recency_factor`` uses exponential decay:

        recency_factor = exp(-ln(2) / half_life_days * days_since_created)

    Parameters
    ----------
    base_score:
        Raw score from enrichment, in [0, 1].
    recency_factor:
        Exponential decay factor based on thread age.
    importance_factor:
        Multiplier assigned by the LLM enrichment step, in (0, 1].
    composite:
        Final composite weight (product of the above three).
    computed_at:
        When these factors were computed.
    """

    base_score: float
    recency_factor: float
    importance_factor: float
    composite: float
    computed_at: datetime


def compute_weight(
    base_score: float,
    importance_factor: float,
    created_at: datetime,
    *,
    half_life_days: float = 7.0,
    reference_time: datetime | None = None,
) -> ThreadWeight:
    """Compute a :class:`ThreadWeight` for a thread.

    Parameters
    ----------
    base_score:
        Raw enrichment score in [0, 1].
    importance_factor:
        Importance multiplier from the LLM, in (0, 1].
    created_at:
        When the thread was created (used for recency decay).
    half_life_days:
        Days after which the recency factor halves.
    reference_time:
        Time to compute decay against.  Defaults to ``datetime.now(UTC)``.
    """
    now = reference_time or datetime.now(UTC)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=UTC)
    days_old = max(0.0, (now - created_at).total_seconds() / 86400.0)
    decay_lambda = math.log(2.0) / half_life_days
    recency_factor = math.exp(-decay_lambda * days_old)
    composite = base_score * recency_factor * importance_factor
    return ThreadWeight(
        base_score=base_score,
        recency_factor=recency_factor,
        importance_factor=importance_factor,
        composite=composite,
        computed_at=now,
    )
