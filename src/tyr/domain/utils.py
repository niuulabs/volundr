"""Shared pure utility functions for the Tyr domain layer."""

from __future__ import annotations

import re


def _slugify(name: str) -> str:
    """Convert a name to a clean slug for branch names and identifiers."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")
