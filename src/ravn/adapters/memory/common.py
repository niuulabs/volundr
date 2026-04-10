"""Shared constants for SQLite-backed Ravn adapters."""

from ravn.adapters.memory.scoring import _CHARS_PER_TOKEN

# Re-export under the public name used by sqlite_outcome and other SQLite adapters.
CHARS_PER_TOKEN = _CHARS_PER_TOKEN
