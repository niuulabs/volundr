"""Niuu CLI entry point — dispatches to registered plugin commands."""

from __future__ import annotations

import argparse

from cli import __version__
from cli.plugins import PLUGIN_REGISTRY


def build_parser() -> argparse.ArgumentParser:
    """Build the top-level argument parser with all registered plugins."""
    parser = argparse.ArgumentParser(
        prog="niuu",
        description="Niuu — self-hosted AI-native development platform",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"niuu {__version__}",
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    for name, plugin in sorted(PLUGIN_REGISTRY.items()):
        plugin.register(subparsers, name)

    return parser


def main(argv: list[str] | None = None) -> int:
    """Parse arguments and dispatch to the appropriate plugin handler."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        return 0

    plugin = PLUGIN_REGISTRY.get(args.command)
    if plugin is None:
        parser.print_help()
        return 1

    return plugin.run(args)
