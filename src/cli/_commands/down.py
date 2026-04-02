"""``niuu down`` — stop Niuu platform services."""

from __future__ import annotations

import argparse


def execute(args: argparse.Namespace) -> int:  # noqa: ARG001
    """Stop all running Niuu services."""
    print("Stopping Niuu platform services …")
    return 0
