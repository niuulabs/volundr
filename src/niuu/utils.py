"""Shared utility functions."""

from __future__ import annotations

import importlib
from functools import lru_cache


@lru_cache(maxsize=256)
def import_class(dotted_path: str) -> type:
    """Import a class from a fully-qualified dotted path.

    Results are cached so repeated imports of the same adapter class
    (e.g. per-request provider instantiation) skip the string split
    and module lookup.
    """
    module_path, class_name = dotted_path.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)
