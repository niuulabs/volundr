"""Persona configuration loader for Ravn.

Personas define the agent's identity, tool access, permission level, and LLM
settings for a given deployment context. They are YAML files stored at
``~/.ravn/personas/<name>.yaml`` or selected from the built-in set.

Activation priority (highest to lowest):
  1. CLI ``--persona`` flag
  2. ``persona:`` field in RAVN.md project manifest
  3. No persona — agent uses Settings defaults directly

When a persona is active, RAVN.md fields override specific persona values so
project-level constraints always take precedence over the persona defaults.

Persona YAML format::

    name: coding-agent
    system_prompt_template: |
      You are a focused coding agent. ...
    allowed_tools: [file, git, terminal, web, todo, introspection]
    forbidden_tools: [cascade, volundr]
    permission_mode: workspace-write
    llm:
      primary_alias: balanced
      thinking_enabled: true
    iteration_budget: 40
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ravn.config import ProjectConfig

_DEFAULT_PERSONAS_DIR = Path.home() / ".ravn" / "personas"

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class PersonaLLMConfig:
    """LLM settings embedded in a persona."""

    primary_alias: str = ""
    thinking_enabled: bool = False


@dataclass
class PersonaConfig:
    """A fully-resolved persona configuration.

    Fields left at their zero-value (empty string, empty list, 0) are
    considered "unset" and will not override Settings defaults when the persona
    is applied.
    """

    name: str
    system_prompt_template: str = ""
    allowed_tools: list[str] = field(default_factory=list)
    forbidden_tools: list[str] = field(default_factory=list)
    permission_mode: str = ""
    llm: PersonaLLMConfig = field(default_factory=PersonaLLMConfig)
    iteration_budget: int = 0


# ---------------------------------------------------------------------------
# Built-in personas
# ---------------------------------------------------------------------------

_BUILTIN_PERSONAS: dict[str, PersonaConfig] = {
    "coding-agent": PersonaConfig(
        name="coding-agent",
        system_prompt_template=(
            "You are a focused coding agent. You write clean, tested, idiomatic code.\n"
            "You follow the project's conventions as described in RAVN.md.\n"
            "You do not explain what you are about to do — you do it, then report what you did."
        ),
        allowed_tools=["file", "git", "terminal", "web", "todo", "introspection"],
        forbidden_tools=["cascade", "volundr"],
        permission_mode="workspace-write",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=True),
        iteration_budget=40,
    ),
    "research-agent": PersonaConfig(
        name="research-agent",
        system_prompt_template=(
            "You are a research agent. You gather, analyse, and synthesise information.\n"
            "You use web search and file tools to find accurate, up-to-date sources.\n"
            "You produce well-structured, cited summaries without modifying project files."
        ),
        allowed_tools=["web", "file", "introspection"],
        forbidden_tools=["git", "terminal", "cascade"],
        permission_mode="read-only",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=False),
        iteration_budget=30,
    ),
    "planning-agent": PersonaConfig(
        name="planning-agent",
        system_prompt_template=(
            "You are a planning agent. You reason carefully before acting.\n"
            "You produce structured plans with clear steps, dependencies, "
            "and acceptance criteria.\n"
            "You do not execute plans — you define them precisely so others can."
        ),
        allowed_tools=["file", "introspection"],
        forbidden_tools=["git", "terminal", "cascade", "volundr"],
        permission_mode="read-only",
        llm=PersonaLLMConfig(primary_alias="powerful", thinking_enabled=True),
        iteration_budget=20,
    ),
    "autonomous-agent": PersonaConfig(
        name="autonomous-agent",
        system_prompt_template=(
            "You are an autonomous agent operating without human supervision.\n"
            "You have full access to all tools. Use them judiciously.\n"
            "Complete the assigned task end-to-end and report outcomes clearly."
        ),
        allowed_tools=[],
        forbidden_tools=[],
        permission_mode="full-access",
        llm=PersonaLLMConfig(primary_alias="powerful", thinking_enabled=True),
        iteration_budget=100,
    ),
}

# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


def _safe_bool(val: Any, default: bool = False) -> bool:
    """Convert *val* to bool, returning *default* on unexpected types."""
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.lower() in {"true", "yes", "1"}
    return default


def _safe_int(val: Any, default: int = 0) -> int:
    """Convert *val* to int, returning *default* on ValueError/TypeError."""
    try:
        return int(val)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return default


class PersonaLoader:
    """Loads persona configurations from YAML files or the built-in set.

    Lookup order for :meth:`load`:
      1. ``personas_dir/<name>.yaml`` (user-defined overrides)
      2. Built-in personas

    Args:
        personas_dir: Directory to search for persona YAML files.
                      Defaults to ``~/.ravn/personas``.
    """

    def __init__(self, personas_dir: Path | None = None) -> None:
        self._personas_dir = personas_dir or _DEFAULT_PERSONAS_DIR

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self, name: str) -> PersonaConfig | None:
        """Load a persona by name.

        Returns the persona from ``personas_dir/<name>.yaml`` if it exists,
        otherwise falls back to the built-in set.  Returns ``None`` when the
        name cannot be resolved.
        """
        file_path = self._personas_dir / f"{name}.yaml"
        if file_path.is_file():
            return self.load_from_file(file_path)
        return _BUILTIN_PERSONAS.get(name)

    def load_from_file(self, path: Path) -> PersonaConfig | None:
        """Parse a persona YAML file.

        Returns ``None`` when the file is unreadable or malformed rather than
        raising, so callers can treat missing personas as a soft error.
        """
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        return self.parse(text)

    def list_builtin_names(self) -> list[str]:
        """Return a sorted list of built-in persona names."""
        return sorted(_BUILTIN_PERSONAS)

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

    @staticmethod
    def parse(text: str) -> PersonaConfig | None:
        """Parse a persona YAML *text* string.

        Returns ``None`` on empty input or parse failure.
        """
        import yaml  # PyYAML — present via pydantic-settings[yaml]

        if not text.strip():
            return None

        try:
            raw = yaml.safe_load(text)
        except Exception:
            return None

        if not isinstance(raw, dict):
            return None

        name = str(raw.get("name", "")).strip()
        if not name:
            return None

        llm_raw: dict[str, Any] = {}
        if isinstance(raw.get("llm"), dict):
            llm_raw = raw["llm"]

        llm = PersonaLLMConfig(
            primary_alias=str(llm_raw.get("primary_alias", "")),
            thinking_enabled=_safe_bool(llm_raw.get("thinking_enabled", False)),
        )

        allowed = raw.get("allowed_tools", [])
        forbidden = raw.get("forbidden_tools", [])

        return PersonaConfig(
            name=name,
            system_prompt_template=str(raw.get("system_prompt_template", "")),
            allowed_tools=list(allowed) if isinstance(allowed, list) else [],
            forbidden_tools=list(forbidden) if isinstance(forbidden, list) else [],
            permission_mode=str(raw.get("permission_mode", "")),
            llm=llm,
            iteration_budget=_safe_int(raw.get("iteration_budget", 0)),
        )

    @staticmethod
    def merge(persona: PersonaConfig, project: ProjectConfig) -> PersonaConfig:
        """Return a new PersonaConfig with RAVN.md *project* overrides applied.

        Non-empty / non-zero project fields take precedence over persona fields.
        The persona's ``name`` and ``llm`` settings are never overridden by
        ProjectConfig (which has no equivalent fields).
        """
        return PersonaConfig(
            name=persona.name,
            system_prompt_template=persona.system_prompt_template,
            allowed_tools=project.allowed_tools if project.allowed_tools else persona.allowed_tools,
            forbidden_tools=(
                project.forbidden_tools if project.forbidden_tools else persona.forbidden_tools
            ),
            permission_mode=(
                project.permission_mode if project.permission_mode else persona.permission_mode
            ),
            llm=persona.llm,
            iteration_budget=(
                project.iteration_budget if project.iteration_budget else persona.iteration_budget
            ),
        )
