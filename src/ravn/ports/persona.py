"""Persona port — interface for persona configuration sources."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ravn.adapters.personas.loader import PersonaConfig


class PersonaPort(ABC):
    """Abstract interface for a persona configuration source.

    A persona defines the agent's identity, allowed tools, permission level,
    and LLM settings for a given context.  By default personas are loaded from
    YAML files in ``~/.ravn/personas/``, but any source that implements this
    port can be used instead.

    To implement a custom persona source::

        from ravn.ports.persona import PersonaPort
        from ravn.adapters.personas.loader import PersonaConfig, PersonaLLMConfig

        class DatabasePersonaAdapter(PersonaPort):
            def __init__(self, dsn: str) -> None:
                self._dsn = dsn

            def load(self, name: str) -> PersonaConfig | None:
                row = db.fetchone("SELECT * FROM personas WHERE name = %s", name)
                if row is None:
                    return None
                return PersonaConfig(name=row["name"], ...)

            def list_names(self) -> list[str]:
                return [r["name"] for r in db.fetchall("SELECT name FROM personas")]

    Register it in ``ravn.yaml``::

        persona_source:
          adapter: mypackage.adapters.DatabasePersonaAdapter
          kwargs:
            dsn: "postgresql://..."
    """

    @abstractmethod
    def load(self, name: str) -> PersonaConfig | None:
        """Return the named persona configuration, or ``None`` if not found.

        Implementations should return ``None`` rather than raising when the
        persona does not exist, so callers can fall back gracefully.
        """
        ...

    @abstractmethod
    def list_names(self) -> list[str]:
        """Return a sorted list of all resolvable persona names."""
        ...
