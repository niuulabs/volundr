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
    produces:
      event_type: review.completed
      schema:
        verdict:
          type: enum
          values: [pass, fail, needs_changes]
        summary:
          type: string
    consumes:
      event_types: [code.changed, review.requested]
      injects: [repo, branch, diff_url]
    fan_in:
      strategy: all_must_pass
      contributes_to: review.verdict
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml as _yaml

from niuu.domain.outcome import OutcomeField, OutcomeSchema, generate_outcome_instruction
from ravn.config import ProjectConfig, _safe_int
from ravn.ports.persona import PersonaRegistryPort

# Bundled personas shipped with the ravn package (src/ravn/personas/*.yaml)
_BUILTIN_PERSONAS_DIR = Path(__file__).parent.parent.parent / "personas"

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
class PersonaProduces:
    """What this persona outputs when it completes.

    event_type: Default event type to publish (used if event_type_map doesn't match)
    event_type_map: Maps outcome field values to event types, e.g.:
        {"pass": "review.passed", "needs_changes": "review.changes_requested"}
        The map is checked against the 'verdict' field in the outcome.
    schema: Expected fields in the outcome block
    """

    event_type: str = ""
    event_type_map: dict[str, str] = field(default_factory=dict)
    schema: dict[str, OutcomeField] = field(default_factory=dict)


@dataclass
class PersonaConsumes:
    """What input this persona expects from previous stages."""

    event_types: list[str] = field(default_factory=list)
    injects: list[str] = field(default_factory=list)


@dataclass
class PersonaFanIn:
    """How this persona's output combines with parallel peers."""

    strategy: Literal["all_must_pass", "any_pass", "majority", "merge"] = "merge"
    contributes_to: str = ""


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
    produces: PersonaProduces = field(default_factory=PersonaProduces)
    consumes: PersonaConsumes = field(default_factory=PersonaConsumes)
    fan_in: PersonaFanIn = field(default_factory=PersonaFanIn)
    # NIU-612: Stop agent loop early when outcome block detected
    stop_on_outcome: bool = False

    def to_dict(self) -> dict:
        """Serialize to a dict compatible with :meth:`FilesystemPersonaAdapter.parse`.

        Zero-value fields (empty string, empty list, ``0``, ``False``) are
        omitted to keep the resulting YAML clean.  Nested dataclasses are
        serialized recursively.
        """
        d: dict = {"name": self.name}

        if self.system_prompt_template:
            d["system_prompt_template"] = self.system_prompt_template
        if self.allowed_tools:
            d["allowed_tools"] = list(self.allowed_tools)
        if self.forbidden_tools:
            d["forbidden_tools"] = list(self.forbidden_tools)
        if self.permission_mode:
            d["permission_mode"] = self.permission_mode

        llm_dict: dict = {}
        if self.llm.primary_alias:
            llm_dict["primary_alias"] = self.llm.primary_alias
        if self.llm.thinking_enabled:
            llm_dict["thinking_enabled"] = self.llm.thinking_enabled
        if self.llm.max_tokens:
            llm_dict["max_tokens"] = self.llm.max_tokens
        if llm_dict:
            d["llm"] = llm_dict

        if self.iteration_budget:
            d["iteration_budget"] = self.iteration_budget

        if self.produces.event_type or self.produces.event_type_map or self.produces.schema:
            produces_dict: dict = {}
            if self.produces.event_type:
                produces_dict["event_type"] = self.produces.event_type
            if self.produces.event_type_map:
                produces_dict["event_type_map"] = dict(self.produces.event_type_map)
            if self.produces.schema:
                schema_dict: dict = {}
                for fname, f in self.produces.schema.items():
                    field_dict: dict = {"type": f.type, "description": f.description}
                    if f.type == "enum" and f.enum_values:
                        field_dict["values"] = list(f.enum_values)
                    if not f.required:
                        field_dict["required"] = False
                    schema_dict[fname] = field_dict
                produces_dict["schema"] = schema_dict
            d["produces"] = produces_dict

        if self.consumes.event_types or self.consumes.injects:
            consumes_dict: dict = {}
            if self.consumes.event_types:
                consumes_dict["event_types"] = list(self.consumes.event_types)
            if self.consumes.injects:
                consumes_dict["injects"] = list(self.consumes.injects)
            d["consumes"] = consumes_dict

        if self.fan_in.strategy != "merge" or self.fan_in.contributes_to:
            fan_in_dict: dict = {"strategy": self.fan_in.strategy}
            if self.fan_in.contributes_to:
                fan_in_dict["contributes_to"] = self.fan_in.contributes_to
            d["fan_in"] = fan_in_dict

        if self.stop_on_outcome:
            d["stop_on_outcome"] = True

        return d


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


_VALID_FAN_IN_STRATEGIES = {"all_must_pass", "any_pass", "majority", "merge"}


def _parse_outcome_field(name: str, raw: Any) -> OutcomeField | None:
    """Parse a single outcome field dict from YAML into an OutcomeField."""
    if not isinstance(raw, dict):
        return None
    field_type = str(raw.get("type", "string"))
    description = str(raw.get("description", name))
    required = _safe_bool(raw.get("required", True), default=True)
    enum_values: list[str] | None = None
    if field_type == "enum":
        vals = raw.get("values") or raw.get("enum_values")
        if isinstance(vals, list):
            enum_values = [str(v) for v in vals]
    return OutcomeField(
        type=field_type,  # type: ignore[arg-type]
        description=description,
        enum_values=enum_values,
        required=required,
    )


def _parse_produces(raw: Any) -> PersonaProduces:
    """Parse the ``produces:`` section of a persona YAML dict."""
    if not isinstance(raw, dict):
        return PersonaProduces()
    event_type = str(raw.get("event_type", ""))
    event_type_map: dict[str, str] = {}
    event_type_map_raw = raw.get("event_type_map")
    if isinstance(event_type_map_raw, dict):
        for k, v in event_type_map_raw.items():
            event_type_map[str(k)] = str(v)
    schema: dict[str, OutcomeField] = {}
    schema_raw = raw.get("schema")
    if isinstance(schema_raw, dict):
        for fname, fval in schema_raw.items():
            parsed = _parse_outcome_field(fname, fval)
            if parsed is not None:
                schema[fname] = parsed
    return PersonaProduces(event_type=event_type, event_type_map=event_type_map, schema=schema)


def _parse_consumes(raw: Any) -> PersonaConsumes:
    """Parse the ``consumes:`` section of a persona YAML dict."""
    if not isinstance(raw, dict):
        return PersonaConsumes()
    event_types_raw = raw.get("event_types", [])
    injects_raw = raw.get("injects", [])
    event_types = list(event_types_raw) if isinstance(event_types_raw, list) else []
    injects = list(injects_raw) if isinstance(injects_raw, list) else []
    return PersonaConsumes(event_types=event_types, injects=injects)


def _parse_fan_in(raw: Any) -> PersonaFanIn:
    """Parse the ``fan_in:`` section of a persona YAML dict."""
    if not isinstance(raw, dict):
        return PersonaFanIn()
    strategy = str(raw.get("strategy", "merge"))
    if strategy not in _VALID_FAN_IN_STRATEGIES:
        strategy = "merge"
    contributes_to = str(raw.get("contributes_to", ""))
    return PersonaFanIn(
        strategy=strategy,  # type: ignore[arg-type]
        contributes_to=contributes_to,
    )


def _apply_outcome_instruction(persona: PersonaConfig) -> PersonaConfig:
    """Append outcome block instruction to system prompt when schema is declared."""
    if not persona.produces.schema:
        return persona
    schema = OutcomeSchema(fields=persona.produces.schema)
    instruction = generate_outcome_instruction(schema)
    return dataclasses.replace(
        persona,
        system_prompt_template=persona.system_prompt_template + "\n\n" + instruction,
    )


class FilesystemPersonaAdapter(PersonaRegistryPort):
    """Loads persona configurations from YAML files on the filesystem.

    Two operating modes depending on whether *persona_dirs* is supplied:

    **Default mode** (``persona_dirs=None``):
      1. Project-local: ``<cwd>/.ravn/personas/<name>.yaml``
      2. User-global: ``~/.ravn/personas/<name>.yaml``
      3. Bundled: ``src/ravn/personas/<name>.yaml`` (shipped with the package)

    **Explicit mode** (``persona_dirs=[...]``):
      1. Each directory in *persona_dirs*, in order (highest priority first)
      2. Bundled directory (if *include_builtin* is ``True``)

      When *persona_dirs* is set, the project-local and user-global paths
      are **not** added automatically.

    Args:
        persona_dirs: Explicit list of directories to search (highest priority
            first).  When ``None``, uses default three-layer discovery:
            ``<cwd>/.ravn/personas/`` → ``~/.ravn/personas/`` → bundled.
        include_builtin: Whether to include the bundled personas directory
            in the search path.
        cwd: Working directory used to resolve ``.ravn/personas/``.
             Defaults to the process working directory at construction time.
    """

    def __init__(
        self,
        persona_dirs: list[str] | None = None,
        *,
        include_builtin: bool = True,
        cwd: Path | None = None,
    ) -> None:
        self._include_builtin = include_builtin
        self._cwd = cwd or Path.cwd()

        if persona_dirs is not None:
            self._persona_dirs: list[Path] | None = [Path(d).expanduser() for d in persona_dirs]
        else:
            self._persona_dirs = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _resolve_dirs(self) -> list[Path]:
        """Return ordered directories to search (highest priority first).

        When *persona_dirs* was supplied explicitly it forms the list
        (with the bundled directory appended when *include_builtin* is
        ``True``); otherwise the default three-layer discovery is used:
          1. Project-local: ``<cwd>/.ravn/personas/``
          2. User-global: ``~/.ravn/personas/``
          3. Bundled: ``src/ravn/personas/`` (when *include_builtin* is ``True``)
        """
        if self._persona_dirs is not None:
            dirs = list(self._persona_dirs)
            if self._include_builtin and _BUILTIN_PERSONAS_DIR not in dirs:
                dirs.append(_BUILTIN_PERSONAS_DIR)
            return dirs
        dirs = [
            self._cwd / ".ravn" / "personas",
            Path.home() / ".ravn" / "personas",
        ]
        if self._include_builtin:
            dirs.append(_BUILTIN_PERSONAS_DIR)
        return dirs

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self, name: str) -> PersonaConfig | None:
        """Load a persona by name, with outcome instruction injected if applicable.

        Iterates ``_resolve_dirs()`` checking for ``<name>.yaml``.
        Returns ``None`` when the name cannot be resolved.

        If the persona declares a ``produces.schema``, the outcome block
        instruction is automatically appended to its system prompt.
        """
        for directory in self._resolve_dirs():
            file_path = directory / f"{name}.yaml"
            if file_path.is_file():
                persona = self.load_from_file(file_path)
                if persona is not None:
                    return _apply_outcome_instruction(persona)

        return None

    def load_from_file(self, path: Path) -> PersonaConfig | None:
        """Parse a persona YAML file without injecting outcome instructions.

        Returns ``None`` when the file is unreadable or malformed rather than
        raising, so callers can treat missing personas as a soft error.

        Note: outcome instruction injection happens in :meth:`load`, not here.
        """
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        return self.parse(text)

    def list_names(self) -> list[str]:
        """Return a sorted list of all resolvable persona names.

        Union of all directory YAML stems (including bundled when enabled).
        """
        names: set[str] = set()
        for directory in self._resolve_dirs():
            if not directory.is_dir():
                continue
            for p in directory.glob("*.yaml"):
                names.add(p.stem)
        return sorted(names)

    # ------------------------------------------------------------------
    # PersonaRegistryPort — write operations
    # ------------------------------------------------------------------

    def save(self, config: PersonaConfig) -> None:
        """Persist *config* as YAML.

        Saves to the first explicitly configured *persona_dir* when one was
        provided at construction time.  Falls back to ``~/.ravn/personas/``
        (user-global) when the adapter is operating in default mode.
        """
        if self._persona_dirs:
            dest_dir = self._persona_dirs[0]
        else:
            dest_dir = Path.home() / ".ravn" / "personas"
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{config.name}.yaml"
        payload: dict[str, Any] = config.to_dict()
        dest.write_text(_yaml.dump(payload, allow_unicode=True), encoding="utf-8")

    def delete(self, name: str) -> bool:
        """Remove the user-defined persona file for *name*.

        Returns ``True`` when a file was found and removed.  Returns ``False``
        when *name* is a pure built-in with no user-defined override file.
        Files in the bundled personas directory are never deleted.
        """
        for directory in self._resolve_dirs():
            if directory == _BUILTIN_PERSONAS_DIR:
                continue
            file_path = directory / f"{name}.yaml"
            if file_path.is_file():
                file_path.unlink()
                return True
        return False

    def is_builtin(self, name: str) -> bool:
        """Return ``True`` when *name* is a built-in persona."""
        return (_BUILTIN_PERSONAS_DIR / f"{name}.yaml").is_file()

    def load_all(self) -> list[PersonaConfig]:
        """Return all resolvable personas with outcome instructions injected."""
        result: list[PersonaConfig] = []
        for name in self.list_names():
            persona = self.load(name)
            if persona is not None:
                result.append(persona)
        return result

    def source(self, name: str) -> str:
        """Return the file path that provides *name*, or ``'[built-in]'``.

        Returns ``'[built-in]'`` when the persona is resolved from the
        bundled personas directory.  Returns an empty string when the
        persona cannot be resolved at all.
        """
        for directory in self._resolve_dirs():
            file_path = directory / f"{name}.yaml"
            if file_path.is_file():
                if directory == _BUILTIN_PERSONAS_DIR:
                    return "[built-in]"
                return str(file_path)
        return ""

    def list_builtin_names(self) -> list[str]:
        """Return a sorted list of built-in persona names."""
        if not _BUILTIN_PERSONAS_DIR.is_dir():
            return []
        return sorted(p.stem for p in _BUILTIN_PERSONAS_DIR.glob("*.yaml"))

    def find_consumers(self, event_type: str) -> list[PersonaConfig]:
        """Return all personas that declare they consume the given event type.

        Used by the pipeline executor to validate pipeline definitions.
        Returns personas with outcome instructions already injected (via :meth:`load`).
        """
        result: list[PersonaConfig] = []
        for name in self.list_names():
            persona = self.load(name)
            if persona and event_type in persona.consumes.event_types:
                result.append(persona)
        return result

    def find_producers(self, event_type: str) -> list[PersonaConfig]:
        """Return all personas that produce the given event type.

        Used by the pipeline executor to validate pipeline definitions.
        Returns personas with outcome instructions already injected (via :meth:`load`).
        """
        result: list[PersonaConfig] = []
        for name in self.list_names():
            persona = self.load(name)
            if persona and persona.produces.event_type == event_type:
                result.append(persona)
        return result

    def find_contributors(self, target: str) -> list[PersonaConfig]:
        """Return all personas whose ``fan_in.contributes_to`` matches *target*.

        Used by the fan-in buffer to determine how many contributor outcomes
        must be collected before the aggregate is ready.
        """
        result: list[PersonaConfig] = []
        for name in self.list_names():
            persona = self.load(name)
            if persona and persona.fan_in.contributes_to == target:
                result.append(persona)
        return result

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

    @staticmethod
    def to_yaml(config: PersonaConfig) -> str:
        """Serialise *config* to a YAML string that :meth:`parse` can round-trip.

        ``system_prompt_template`` is rendered in block scalar style (``|``) so
        that multi-line prompts remain human-readable.
        """
        import yaml  # PyYAML — present via pydantic-settings[yaml]

        class _LiteralStr(str):
            pass

        class _PersonaDumper(yaml.Dumper):
            pass

        def _literal_representer(dumper: yaml.Dumper, data: str) -> yaml.ScalarNode:
            return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")

        _PersonaDumper.add_representer(_LiteralStr, _literal_representer)

        d = config.to_dict()
        if "system_prompt_template" in d and "\n" in d["system_prompt_template"]:
            d["system_prompt_template"] = _LiteralStr(d["system_prompt_template"])

        return yaml.dump(d, default_flow_style=False, sort_keys=False, Dumper=_PersonaDumper)

    @staticmethod
    def parse(text: str) -> PersonaConfig | None:
        """Parse a persona YAML *text* string.

        Returns ``None`` on empty input or parse failure.
        Handles ``produces``, ``consumes``, and ``fan_in`` sections.
        """
        if not text.strip():
            return None

        try:
            raw = _yaml.safe_load(text)
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
            produces=_parse_produces(raw.get("produces")),
            consumes=_parse_consumes(raw.get("consumes")),
            fan_in=_parse_fan_in(raw.get("fan_in")),
            stop_on_outcome=_safe_bool(raw.get("stop_on_outcome", False)),
        )

    @staticmethod
    def merge(persona: PersonaConfig, project: ProjectConfig) -> PersonaConfig:
        """Return a new PersonaConfig with RAVN.md *project* overrides applied.

        Non-empty / non-zero project fields take precedence over persona fields.
        The persona's ``name``, ``llm``, ``produces``, ``consumes``, and
        ``fan_in`` settings are never overridden by ProjectConfig (which has no
        equivalent fields).
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
            produces=persona.produces,
            consumes=persona.consumes,
            fan_in=persona.fan_in,
        )
