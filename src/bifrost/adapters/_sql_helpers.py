"""Shared SQL helpers for asyncpg-backed adapters."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


def to_utc(dt: datetime) -> datetime:
    """Normalise *dt* to UTC."""
    return dt.astimezone(UTC)


def build_where(
    filters: list[tuple[str, Any]],
    start_idx: int = 1,
) -> tuple[str, list[Any]]:
    """Build a ``WHERE`` clause from *(column, value)* pairs.

    Returns the clause string (empty when *filters* is empty) and the
    positional parameter list suitable for ``asyncpg``.
    """
    clauses: list[str] = []
    params: list[Any] = []
    idx = start_idx

    for col, val in filters:
        clauses.append(f"{col} = ${idx}")
        params.append(val)
        idx += 1

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


def build_where_with_range(
    filters: list[tuple[str, Any]],
    since: datetime | None = None,
    until: datetime | None = None,
    start_idx: int = 1,
) -> tuple[str, list[Any]]:
    """Like :func:`build_where` but also appends timestamp range filters."""
    clauses: list[str] = []
    params: list[Any] = []
    idx = start_idx

    for col, val in filters:
        clauses.append(f"{col} = ${idx}")
        params.append(val)
        idx += 1

    if since is not None:
        clauses.append(f"timestamp >= ${idx}")
        params.append(to_utc(since))
        idx += 1
    if until is not None:
        clauses.append(f"timestamp <= ${idx}")
        params.append(to_utc(until))

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params
