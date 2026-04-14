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
class PersonaProduces:
    """What this persona outputs when it completes."""

    event_type: str = ""
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
        """Serialize this persona to a plain dict compatible with :meth:`PersonaLoader.parse`.

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

        if self.produces.event_type or self.produces.schema:
            produces_dict: dict = {}
            if self.produces.event_type:
                produces_dict["event_type"] = self.produces.event_type
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
        produces=PersonaProduces(
            event_type="code.changed",
            schema={
                "files_changed": OutcomeField(
                    type="number", description="number of files modified"
                ),
                "tests_added": OutcomeField(type="number", description="number of tests added"),
                "summary": OutcomeField(type="string", description="one-line summary of changes"),
            },
        ),
        consumes=PersonaConsumes(
            event_types=["code.requested", "bug.fix.requested", "feature.requested"],
        ),
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
            "## Dream cycle mode\n"
            "When the task context begins with 'Dream cycle run —', execute the following "
            "steps in order (all steps are required unless explicitly budget-gated):\n\n"
            "**Step 1 — Scan log**: Read `wiki/log.md` and identify all sources and pages "
            "ingested or modified since the 'Last run' timestamp in the task context.\n\n"
            "**Step 2 — Entity detection**: For each new/modified raw source from Step 1, "
            "call `mimir_ingest` to extract entities (skip if already processed by ingest). "
            "Track entities_created count.\n\n"
            "**Step 3 — Compiled truth audit**: For each entity, call `mimir_search` to "
            "find related compiled truth pages and assess whether new evidence changes "
            "the current understanding.\n\n"
            "**Step 4 — Compiled truth update**: Rewrite affected Compiled Truth sections "
            "via `mimir_write`.  Preserve existing Timeline entries.  Track pages_updated "
            "count.\n\n"
            "**Step 5 — Lint with auto-fix**: Call `mimir_lint` with `fix=true`.  "
            "Record lint_fixes count from the response.\n\n"
            "**Step 6 — Cross-reference**: Find pages mentioning the same entities as "
            "updated pages but lacking wikilinks; add missing links via `mimir_write`.\n\n"
            "**Step 7 — Log and emit**: Append a summary entry to `wiki/log.md` with "
            "timestamp, pages_updated, entities_created, and lint_fixes.  Then call "
            "`sleipnir_publish` to emit a `mimir.dream.completed` event with those counts.\n\n"
            "Idempotency: all writes must be conditional — only write a page if its "
            "content would actually change.  Running the dream cycle twice must produce "
            "no additional changes on the second run.\n\n"
            "## Idle behaviour\n"
            "When no synthesis task is pending, call `mimir_lint` to identify stale pages, "
            "orphans, or concept gaps."
        ),
        allowed_tools=["mimir", "web", "file", "ravn"],
        forbidden_tools=["git", "terminal", "cascade", "volundr"],
        permission_mode="workspace-write",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=False),
        iteration_budget=60,
        produces=PersonaProduces(
            event_type="dream.completed",
            schema={
                "pages_updated": OutcomeField(
                    type="number", description="number of wiki pages updated"
                ),
                "entities_created": OutcomeField(
                    type="number", description="number of entities created"
                ),
                "lint_fixes": OutcomeField(
                    type="number", description="number of lint fixes applied"
                ),
                "summary": OutcomeField(type="string", description="one-line summary"),
            },
        ),
        consumes=PersonaConsumes(event_types=["cron.weekly", "mimir.dream.requested"]),
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
    # --- Specialist pipeline personas ---
    "reviewer": PersonaConfig(
        name="reviewer",
        system_prompt_template=(
            "You are a code reviewer. You read diffs, identify issues, and produce a "
            "structured verdict with detailed findings.\n\n"
            "## Your responsibilities\n"
            "- Review the diff or files at the provided repo/branch.\n"
            "- Count all findings, distinguishing critical from non-critical.\n"
            "- Apply `pass` when changes are ready to merge with no blocking issues.\n"
            "- Apply `needs_changes` for non-critical issues requiring revision.\n"
            "- Apply `fail` for critical issues blocking merge.\n"
            "- Write a concise one-line summary of the overall review."
        ),
        allowed_tools=["file", "git", "web", "ravn"],
        forbidden_tools=["terminal", "cascade"],
        permission_mode="read-only",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=True),
        iteration_budget=20,
        produces=PersonaProduces(
            event_type="review.completed",
            schema={
                "verdict": OutcomeField(
                    type="enum",
                    description="review verdict",
                    enum_values=["pass", "fail", "needs_changes"],
                ),
                "findings_count": OutcomeField(
                    type="number", description="total number of findings"
                ),
                "critical_count": OutcomeField(
                    type="number", description="number of critical findings"
                ),
                "summary": OutcomeField(type="string", description="one-line review summary"),
            },
        ),
        consumes=PersonaConsumes(
            event_types=["code.changed", "review.requested"],
            injects=["repo", "branch", "diff_url"],
        ),
        fan_in=PersonaFanIn(strategy="all_must_pass", contributes_to="review.verdict"),
    ),
    "security-auditor": PersonaConfig(
        name="security-auditor",
        system_prompt_template=(
            "You are a security auditor. You analyse code changes for security "
            "vulnerabilities and produce a structured security verdict.\n\n"
            "## Your responsibilities\n"
            "- Review the diff or files at the provided repo/branch for security issues.\n"
            "- Look for OWASP Top 10 vulnerabilities, secrets in code, insecure patterns.\n"
            "- Count critical security findings (e.g. injection, auth bypass, data exposure).\n"
            "- Apply `pass` when no security issues are found.\n"
            "- Apply `needs_review` for issues requiring attention but not blocking.\n"
            "- Apply `fail` for critical security vulnerabilities blocking merge.\n"
            "- Write a concise one-line summary of your security assessment."
        ),
        allowed_tools=["file", "git", "web", "ravn"],
        forbidden_tools=["terminal", "cascade"],
        permission_mode="read-only",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=True),
        iteration_budget=20,
        produces=PersonaProduces(
            event_type="security.completed",
            schema={
                "verdict": OutcomeField(
                    type="enum",
                    description="security verdict",
                    enum_values=["pass", "fail", "needs_review"],
                ),
                "critical_findings": OutcomeField(
                    type="number", description="number of critical security findings"
                ),
                "summary": OutcomeField(
                    type="string", description="one-line security assessment summary"
                ),
            },
        ),
        consumes=PersonaConsumes(
            event_types=["code.changed"],
            injects=["repo", "branch"],
        ),
        fan_in=PersonaFanIn(strategy="all_must_pass", contributes_to="review.verdict"),
    ),
    "qa-agent": PersonaConfig(
        name="qa-agent",
        system_prompt_template=(
            "You are a QA agent. You validate that code changes pass quality checks "
            "and produce a structured test verdict.\n\n"
            "## Your responsibilities\n"
            "- Run or evaluate tests for the provided repo/branch.\n"
            "- Report the total number of tests run and how many failed.\n"
            "- Apply `pass` when all tests pass.\n"
            "- Apply `fail` when one or more tests fail.\n"
            "- Write a concise one-line summary of the test results."
        ),
        allowed_tools=["file", "git", "terminal", "ravn"],
        forbidden_tools=["cascade", "volundr"],
        permission_mode="workspace-write",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=False),
        iteration_budget=30,
        produces=PersonaProduces(
            event_type="qa.completed",
            schema={
                "verdict": OutcomeField(
                    type="enum",
                    description="QA verdict",
                    enum_values=["pass", "fail"],
                ),
                "tests_run": OutcomeField(type="number", description="total tests run"),
                "tests_failed": OutcomeField(type="number", description="tests that failed"),
                "summary": OutcomeField(type="string", description="one-line test results summary"),
            },
        ),
        consumes=PersonaConsumes(
            event_types=["review.completed", "test.requested"],
            injects=["repo", "branch", "previous_verdicts"],
        ),
    ),
    "ship-agent": PersonaConfig(
        name="ship-agent",
        system_prompt_template=(
            "You are a ship agent. You merge approved changes, tag releases, and "
            "produce a structured shipping verdict.\n\n"
            "## Your responsibilities\n"
            "- Verify that all upstream verdicts (review, QA) pass before shipping.\n"
            "- Merge the branch and create a release tag.\n"
            "- Record the version and PR URL.\n"
            "- Apply `shipped` when the change is successfully merged and released.\n"
            "- Apply `blocked` when any upstream gate has not passed.\n"
            "- Write a concise one-line summary of the shipping action."
        ),
        allowed_tools=["file", "git", "terminal", "web", "ravn"],
        forbidden_tools=["cascade"],
        permission_mode="workspace-write",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=False),
        iteration_budget=15,
        produces=PersonaProduces(
            event_type="ship.completed",
            schema={
                "verdict": OutcomeField(
                    type="enum",
                    description="ship verdict",
                    enum_values=["shipped", "blocked"],
                ),
                "version": OutcomeField(type="string", description="released version tag"),
                "pr_url": OutcomeField(type="string", description="pull request URL"),
                "summary": OutcomeField(type="string", description="one-line shipping summary"),
            },
        ),
        consumes=PersonaConsumes(
            event_types=["qa.completed", "ship.requested"],
            injects=["repo", "branch", "previous_verdicts"],
        ),
    ),
    "retro-analyst": PersonaConfig(
        name="retro-analyst",
        system_prompt_template=(
            "You are a retrospective analyst. You review shipped work over a time period, "
            "identify patterns, and produce a structured retrospective report.\n\n"
            "## Your responsibilities\n"
            "- Count the items shipped since the last retrospective.\n"
            "- Identify recurring patterns (positive and negative) in the work.\n"
            "- Write a concise one-line summary of the retrospective findings."
        ),
        allowed_tools=["mimir", "file", "ravn"],
        forbidden_tools=["terminal", "cascade"],
        permission_mode="read-only",
        llm=PersonaLLMConfig(primary_alias="balanced", thinking_enabled=False),
        iteration_budget=15,
        produces=PersonaProduces(
            event_type="retro.completed",
            schema={
                "items_shipped": OutcomeField(type="number", description="number of items shipped"),
                "patterns_found": OutcomeField(
                    type="number", description="number of patterns identified"
                ),
                "summary": OutcomeField(
                    type="string", description="one-line retrospective summary"
                ),
            },
        ),
        consumes=PersonaConsumes(
            event_types=["retro.requested", "cron.weekly"],
        ),
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
    schema: dict[str, OutcomeField] = {}
    schema_raw = raw.get("schema")
    if isinstance(schema_raw, dict):
        for fname, fval in schema_raw.items():
            parsed = _parse_outcome_field(fname, fval)
            if parsed is not None:
                schema[fname] = parsed
    return PersonaProduces(event_type=event_type, schema=schema)


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


class PersonaLoader(PersonaRegistryPort):
    """Loads persona configurations from YAML files or the built-in set.

    Two operating modes depending on whether *persona_dirs* is supplied:

    **Default mode** (``persona_dirs=None``):
      1. Project-local: ``<cwd>/.ravn/personas/<name>.yaml``
      2. User-global: ``~/.ravn/personas/<name>.yaml``
      3. Built-in personas (if *include_builtin* is ``True``)

    **Explicit mode** (``persona_dirs=[...]``):
      1. Each directory in *persona_dirs*, in order (highest priority first)
      2. Built-in personas (if *include_builtin* is ``True``)

      When *persona_dirs* is set, the project-local and user-global paths
      are **not** added automatically.

    Args:
        persona_dirs: Explicit list of directories to search (highest priority
            first).  When ``None``, uses default two-layer discovery:
            ``<cwd>/.ravn/personas/`` → ``~/.ravn/personas/``.
        include_builtin: Whether to include built-in personas.
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

        When *persona_dirs* was supplied explicitly it forms the list;
        otherwise the default two-layer (project-local → user-global) paths
        are used.
        """
        if self._persona_dirs is not None:
            return list(self._persona_dirs)
        return [
            self._cwd / ".ravn" / "personas",
            Path.home() / ".ravn" / "personas",
        ]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self, name: str) -> PersonaConfig | None:
        """Load a persona by name, with outcome instruction injected if applicable.

        Iterates ``_resolve_dirs()`` checking for ``<name>.yaml``; falls back
        to the built-in set.  Returns ``None`` when the name cannot be resolved.

        If the persona declares a ``produces.schema``, the outcome block
        instruction is automatically appended to its system prompt.
        """
        for directory in self._resolve_dirs():
            file_path = directory / f"{name}.yaml"
            if file_path.is_file():
                persona = self.load_from_file(file_path)
                if persona is not None:
                    return _apply_outcome_instruction(persona)

        if self._include_builtin:
            persona = _BUILTIN_PERSONAS.get(name)
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

        Union of all directory YAML stems plus built-in names.
        """
        names: set[str] = set()
        for directory in self._resolve_dirs():
            if not directory.is_dir():
                continue
            for p in directory.glob("*.yaml"):
                names.add(p.stem)
        if self._include_builtin:
            names.update(_BUILTIN_PERSONAS)
        return sorted(names)

    # ------------------------------------------------------------------
    # PersonaRegistryPort — write operations
    # ------------------------------------------------------------------

    def save(self, config: PersonaConfig) -> None:
        """Persist *config* to the user-global personas directory as YAML.

        Writes to ``~/.ravn/personas/<name>.yaml``, creating the directory if
        it does not exist.
        """
        dest_dir = Path.home() / ".ravn" / "personas"
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{config.name}.yaml"
        payload: dict[str, Any] = config.to_dict()
        dest.write_text(_yaml.dump(payload, allow_unicode=True), encoding="utf-8")

    def delete(self, name: str) -> bool:
        """Remove the user-defined persona file for *name*.

        Returns ``True`` when a file was found and removed.  Returns ``False``
        when *name* is a pure built-in with no user-defined override file.
        """
        for directory in self._resolve_dirs():
            file_path = directory / f"{name}.yaml"
            if file_path.is_file():
                file_path.unlink()
                return True
        return False

    def is_builtin(self, name: str) -> bool:
        """Return ``True`` when *name* is a built-in persona."""
        return name in _BUILTIN_PERSONAS

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

        Returns an empty string when the persona cannot be resolved at all.
        """
        for directory in self._resolve_dirs():
            file_path = directory / f"{name}.yaml"
            if file_path.is_file():
                return str(file_path)
        if self._include_builtin and name in _BUILTIN_PERSONAS:
            return "[built-in]"
        return ""

    def list_builtin_names(self) -> list[str]:
        """Return a sorted list of built-in persona names."""
        return sorted(_BUILTIN_PERSONAS)

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
