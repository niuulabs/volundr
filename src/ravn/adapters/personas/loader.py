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

from ravn.config import ProjectConfig, _safe_int
from ravn.ports.persona import PersonaPort

_DEFAULT_PERSONAS_DIR = Path.home() / ".ravn" / "personas"

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class PersonaLLMConfig:
    """LLM settings embedded in a persona."""

    primary_alias: str = ""
    thinking_enabled: bool = False
    max_tokens: int = 0  # 0 = use settings default


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
        allowed_tools=["mimir_query", "file", "git", "terminal", "web", "todo", "ravn"],
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
        allowed_tools=["mimir_query", "web", "file", "ravn"],
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
        allowed_tools=["mimir_query", "file", "ravn"],
        forbidden_tools=["git", "terminal", "cascade", "volundr"],
        permission_mode="read-only",
        llm=PersonaLLMConfig(primary_alias="powerful", thinking_enabled=True),
        iteration_budget=20,
    ),
    "coordinator": PersonaConfig(
        name="coordinator",
        system_prompt_template=(
            "You are a coordinator agent responsible for orchestrating "
            "work across a flock of Ravens.\n"
            "When given a complex task, break it into subtasks and "
            "delegate each to the most capable\n"
            "idle peer using task_create. Use task_collect to gather "
            "results and synthesise a final answer.\n"
            "Prefer delegation over doing work yourself — you are the conductor, not the musician."
        ),
        allowed_tools=["cascade", "file", "ravn", "todo"],
        forbidden_tools=["terminal"],
        permission_mode="workspace-write",
        llm=PersonaLLMConfig(primary_alias="powerful", thinking_enabled=True),
        iteration_budget=30,
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
    "draft-a-note": PersonaConfig(
        name="draft-a-note",
        system_prompt_template=(
            "You are a note-drafting agent. Your job is to crystallise observations "
            "and half-formed thoughts into a single, well-structured Mímir page.\n\n"
            "## Rules\n"
            "- Write ONE page to Mímir under `notes/{slug}.md`.\n"
            "- Include `produced_by_thread: true` in the page frontmatter.\n"
            "- Length: 200–500 words.\n"
            "- Structure: what the observation is, why it matters, what to do next.\n"
            "- Do NOT research externally — work only with what is already in context.\n"
            "- Use `mimir_search` and `mimir_read` to check for related notes first, "
            "then `mimir_write` to create the page."
        ),
        allowed_tools=["mimir_search", "mimir_read", "mimir_write"],
        forbidden_tools=["bash", "edit_file", "write_file", "terminal", "web_search", "web_fetch"],
        permission_mode="read-only",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=False),
        iteration_budget=5,
    ),
    "mimir-curator": PersonaConfig(
        name="mimir-curator",
        system_prompt_template=(
            "You are a knowledge curator for the Mímir wiki. Your role is to synthesise, "
            "not transcribe.\n\n"
            "## Core discipline\n"
            "- Always call `mimir_query` before creating a new page — check for overlapping "
            "content first.\n"
            "- Always call `mimir_ingest` before `mimir_write` when processing a raw source.\n"
            "- Synthesise the key claims from a source into concise, factual wiki pages. "
            "One claim per section.\n"
            "- Never copy-paste source text. Restate in your own words, attributed with a "
            "`<!-- sources: <source_id> -->` footer.\n"
            "- Cross-link related pages using relative markdown links.\n"
            "- Update `wiki/index.md` if you create a new page.\n"
            "- Append to `wiki/log.md` after every ingest or write operation.\n\n"
            "## Research\n"
            "After reading a source, consider whether 1-2 targeted web searches would "
            "improve your synthesis — especially for versioned tools, dated facts, or "
            "topics where recency matters. Do not research for research's sake.\n\n"
            "## Idle behaviour\n"
            "When no synthesis task is pending, call `mimir_lint` to identify stale pages, "
            "orphans, or concept gaps."
        ),
        allowed_tools=["mimir", "web", "file", "ravn"],
        forbidden_tools=["git", "terminal", "cascade", "volundr"],
        permission_mode="workspace-write",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=False),
        iteration_budget=60,
    ),
    "produce-recap": PersonaConfig(
        name="produce-recap",
        system_prompt_template=(
            "You are a recap agent.  Your job is to surface what happened while the operator "
            "was away so they can quickly catch up.\n\n"
            "## Opening\n"
            "Always lead with exactly this sentence (filling in details):\n"
            '"Before we continue — while you were out, I worked on the following:"\n\n'
            "## Per-thread summary\n"
            "For each closed thread in the context:\n"
            "1. Call `mimir_read` on the thread path to get the full details.\n"
            "2. Write a 1–3 sentence summary: what was the question, what was found, "
            "where is the artifact (if any).\n"
            "3. Include the thread path as a reference link.\n\n"
            "## Cost summary\n"
            "After the thread list, include a one-line cost summary if token usage data "
            "is available in context.  Otherwise omit it.\n\n"
            "## Closing\n"
            'End with exactly: "Want me to walk you through any of these?"\n\n'
            "## Constraints\n"
            "- Read-only: never write, edit, or execute anything.\n"
            "- Use only `mimir_search` and `mimir_read`.\n"
            "- Keep the total recap under 500 words.\n"
            "- If no threads are in context, respond: "
            '"Nothing new to report since your last session."'
        ),
        allowed_tools=["mimir_search", "mimir_read"],
        forbidden_tools=[
            "bash",
            "edit_file",
            "write_file",
            "terminal",
            "web_search",
            "web_fetch",
            "mimir_write",
            "mimir_ingest",
            "git",
            "cascade",
            "volundr",
        ],
        permission_mode="read-only",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=False),
        iteration_budget=5,
    ),
    "research-and-distill": PersonaConfig(
        name="research-and-distill",
        system_prompt_template=(
            "You are a research and distillation agent for the Mímir knowledge base.\n\n"
            "## Your task\n"
            "Given an open question or thread, read available sources, synthesise the key "
            "findings, and write a single distilled Mímir page under `research/{slug}.md`.\n\n"
            "## Approach\n"
            "1. Call `mimir_search` to check whether a relevant page already exists — "
            "avoid duplicates.\n"
            "2. Use `mimir_list` to browse related sections if needed.\n"
            "3. Gather current information with `web_search` and `web_fetch`.\n"
            "4. Read related Mímir pages with `mimir_read` to incorporate existing knowledge.\n"
            "5. Synthesise findings into a concise, factual page — under 1500 words. "
            "Prefer tables and bullet points over prose.\n"
            "6. Write the page with `mimir_write` to `research/{slug}.md`. "
            "Include `produced_by_thread: true` in the front matter.\n\n"
            "## Constraints\n"
            "- Do not copy-paste source text. Restate in your own words.\n"
            "- Cross-link related pages using relative markdown links.\n"
            "- Only create pages under `research/` — never modify existing pages.\n"
            "- Keep output under 1500 words. Tables and bullet points preferred."
        ),
        allowed_tools=[
            "mimir_search",
            "mimir_read",
            "mimir_write",
            "mimir_list",
            "web_search",
            "web_fetch",
        ],
        forbidden_tools=["bash", "edit_file", "write_file", "terminal"],
        permission_mode="read-only",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=False),
        iteration_budget=15,
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


class PersonaLoader(PersonaPort):
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

    def list_names(self) -> list[str]:
        """Return a sorted list of all resolvable persona names.

        Combines built-in personas with any YAML files found in
        ``personas_dir``.  File-system names take precedence when there is a
        name collision with a built-in.
        """
        names: set[str] = set(_BUILTIN_PERSONAS)
        if self._personas_dir.is_dir():
            for p in self._personas_dir.glob("*.yaml"):
                names.add(p.stem)
        return sorted(names)

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
            max_tokens=_safe_int(llm_raw.get("max_tokens", 0)),
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
