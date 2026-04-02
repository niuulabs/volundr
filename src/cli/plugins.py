"""Plugin registry — discovers and registers CLI sub-commands.

Each plugin exposes two callables:
  - ``register(app, name)`` — adds its Typer sub-command
  - ``run(**kwargs) -> int``  — executes the command, returns exit code

Plugins are organised by the service they belong to (volundr, tyr, skuld)
plus cross-cutting commands like ``up``, ``version``, and ``migrate``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import typer


class PluginCommand(Protocol):
    """Interface every CLI plugin must satisfy."""

    description: str

    def register(self, app: typer.Typer, name: str) -> None: ...

    def run(self, **kwargs: Any) -> int: ...


# ---------------------------------------------------------------------------
# Built-in commands
# ---------------------------------------------------------------------------


@dataclass
class UpCommand:
    """Start all Niuu services (Volundr API, Tyr dispatcher, Skuld broker)."""

    description: str = "Start Niuu platform services"

    def register(self, app: typer.Typer, name: str) -> None:
        @app.command(name=name, help=self.description)
        def _cmd() -> None:
            self.run()

    def run(self, **kwargs: Any) -> int:
        from cli._commands.up import execute

        return execute()


@dataclass
class DownCommand:
    """Stop all Niuu services."""

    description: str = "Stop Niuu platform services"

    def register(self, app: typer.Typer, name: str) -> None:
        @app.command(name=name, help=self.description)
        def _cmd() -> None:
            self.run()

    def run(self, **kwargs: Any) -> int:
        from cli._commands.down import execute

        return execute()


@dataclass
class MigrateCommand:
    """Run database migrations."""

    description: str = "Run database migrations"

    def register(self, app: typer.Typer, name: str) -> None:
        @app.command(name=name, help=self.description)
        def _cmd(
            target: str = typer.Option("latest", help="Migration target version"),
        ) -> None:
            self.run(target=target)

    def run(self, **kwargs: Any) -> int:
        from cli._commands.migrate import execute

        return execute(target=kwargs.get("target", "latest"))


@dataclass
class StatusCommand:
    """Show platform service status."""

    description: str = "Show platform service status"

    def register(self, app: typer.Typer, name: str) -> None:
        @app.command(name=name, help=self.description)
        def _cmd() -> None:
            self.run()

    def run(self, **kwargs: Any) -> int:
        from cli._commands.status import execute

        return execute()


@dataclass
class ServeCommand:
    """Serve the web UI (development helper)."""

    description: str = "Serve the Niuu web UI"

    def register(self, app: typer.Typer, name: str) -> None:
        @app.command(name=name, help=self.description)
        def _cmd(
            port: int = typer.Option(5174, help="Port (default: 5174)"),
        ) -> None:
            self.run(port=port)

    def run(self, **kwargs: Any) -> int:
        from cli._commands.serve import execute

        return execute(port=kwargs.get("port", 5174))


# ---------------------------------------------------------------------------
# Registry — maps command name -> plugin instance
# ---------------------------------------------------------------------------

PLUGIN_REGISTRY: dict[str, PluginCommand] = {
    "up": UpCommand(),
    "down": DownCommand(),
    "migrate": MigrateCommand(),
    "status": StatusCommand(),
    "serve": ServeCommand(),
}
