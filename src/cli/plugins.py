"""Plugin registry — discovers and registers CLI sub-commands.

Each plugin exposes two callables:
  - ``register(subparsers, name)`` — adds its argparse sub-parser
  - ``run(args) -> int``            — executes the command, returns exit code

Plugins are organised by the service they belong to (volundr, tyr, skuld)
plus cross-cutting commands like ``up``, ``version``, and ``migrate``.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from typing import Protocol


class PluginCommand(Protocol):
    """Interface every CLI plugin must satisfy."""

    description: str

    def register(self, subparsers: argparse._SubParsersAction, name: str) -> None: ...

    def run(self, args: argparse.Namespace) -> int: ...


# ---------------------------------------------------------------------------
# Built-in commands
# ---------------------------------------------------------------------------


@dataclass
class UpCommand:
    """Start all Niuu services (Volundr API, Tyr dispatcher, Skuld broker)."""

    description: str = "Start Niuu platform services"

    def register(self, subparsers: argparse._SubParsersAction, name: str) -> None:
        subparsers.add_parser(name, help=self.description)

    def run(self, args: argparse.Namespace) -> int:
        # Lazy import to keep startup fast
        from cli._commands.up import execute

        return execute(args)


@dataclass
class DownCommand:
    """Stop all Niuu services."""

    description: str = "Stop Niuu platform services"

    def register(self, subparsers: argparse._SubParsersAction, name: str) -> None:
        subparsers.add_parser(name, help=self.description)

    def run(self, args: argparse.Namespace) -> int:
        from cli._commands.down import execute

        return execute(args)


@dataclass
class MigrateCommand:
    """Run database migrations."""

    description: str = "Run database migrations"

    def register(self, subparsers: argparse._SubParsersAction, name: str) -> None:
        sub = subparsers.add_parser(name, help=self.description)
        sub.add_argument(
            "--target",
            default="latest",
            help="Migration target version (default: latest)",
        )

    def run(self, args: argparse.Namespace) -> int:
        from cli._commands.migrate import execute

        return execute(args)


@dataclass
class StatusCommand:
    """Show platform service status."""

    description: str = "Show platform service status"

    def register(self, subparsers: argparse._SubParsersAction, name: str) -> None:
        subparsers.add_parser(name, help=self.description)

    def run(self, args: argparse.Namespace) -> int:
        from cli._commands.status import execute

        return execute(args)


@dataclass
class ServeCommand:
    """Serve the web UI (development helper)."""

    description: str = "Serve the Niuu web UI"

    def register(self, subparsers: argparse._SubParsersAction, name: str) -> None:
        sub = subparsers.add_parser(name, help=self.description)
        sub.add_argument("--port", type=int, default=5174, help="Port (default: 5174)")

    def run(self, args: argparse.Namespace) -> int:
        from cli._commands.serve import execute

        return execute(args)


# ---------------------------------------------------------------------------
# Registry — maps command name → plugin instance
# ---------------------------------------------------------------------------

PLUGIN_REGISTRY: dict[str, PluginCommand] = {
    "up": UpCommand(),
    "down": DownCommand(),
    "migrate": MigrateCommand(),
    "status": StatusCommand(),
    "serve": ServeCommand(),
}
