"""Plugin port — shared ABCs for the niuu CLI plugin system.

These live in niuu so that both volundr and tyr can implement
ServicePlugin without importing from cli (which would create a
bidirectional dependency).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Sequence

    import typer
    from textual.widget import Widget


class Service(ABC):
    """Lifecycle interface for a managed service."""

    @abstractmethod
    async def start(self) -> None:
        """Start the service."""

    @abstractmethod
    async def stop(self) -> None:
        """Stop the service gracefully."""

    @abstractmethod
    async def health_check(self) -> bool:
        """Return True if the service is healthy."""


@dataclass(frozen=True)
class TUIPageSpec:
    """Specification for a TUI page registered by a plugin."""

    name: str
    icon: str
    widget_class: type[Widget]


class ServicePlugin(ABC):
    """Base class for niuu CLI plugins.

    Each package (volundr, tyr, etc.) implements this to register its
    commands, services, API clients, and TUI pages.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique plugin name (e.g. 'volundr')."""

    @property
    @abstractmethod
    def description(self) -> str:
        """Short description of the plugin."""

    def create_service(self) -> Service | None:
        """Create the managed service instance, or None if not applicable."""
        return None

    def register_commands(self, app: typer.Typer) -> None:
        """Register CLI commands on the given Typer app."""

    def create_api_client(self) -> Any:
        """Create an async API client for this service, or None."""
        return None

    def tui_pages(self) -> Sequence[TUIPageSpec]:
        """Return TUI page specs for the Textual app."""
        return []

    def depends_on(self) -> Sequence[str]:
        """Return names of plugins this plugin depends on for startup."""
        return []
