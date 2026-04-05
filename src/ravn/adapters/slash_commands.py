"""Slash command dispatcher for the Ravn CLI.

Slash commands let users inspect and control the running agent without
breaking the conversational flow.  Every command starts with '/' and is
handled synchronously, returning a formatted string to be printed by the
caller.

Commands
--------
/help     — list all slash commands and active tools
/tools    — show loaded tool registry with permission levels
/memory   — show episodic memory summary for this session
/compact  — clear conversation history to reclaim context budget
/budget   — show iteration budget: used / remaining / limit
/todo     — show current todo list
/status   — full agent state dump
/init     — bootstrap a RAVN.md in the current working directory
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ravn.domain.models import Session
from ravn.ports.tool import ToolPort

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_HELP_TEXT = """\
Ravn slash commands:

  /help     — show this help message
  /tools    — show loaded tool registry with permission levels
  /memory   — show episodic memory summary for this session
  /compact  — clear conversation history to reclaim context budget
  /budget   — show iteration budget: used / remaining / limit
  /todo     — show current todo list
  /status   — full agent state dump
  /skills   — list all available skills
  /init     — bootstrap a RAVN.md in the current directory\
"""

_RAVN_MD_TEMPLATE = """\
# RAVN Project: {project_name}

persona: coding-agent
allowed_tools: [file, git, terminal, web]
forbidden_tools: []
permission_mode: allow_all
iteration_budget: 20
notes: >
  Add project-specific instructions here.
  Ravn will include these in its system prompt.
"""

_TODO_STATUS_ICONS: dict[str, str] = {
    "pending": "○",
    "in_progress": "◑",
    "done": "✓",
    "cancelled": "✗",
}


# ---------------------------------------------------------------------------
# Context dataclass
# ---------------------------------------------------------------------------


@dataclass
class SlashCommandContext:
    """Ambient state forwarded to every slash command handler.

    The caller (typically the CLI REPL) populates this once per REPL
    iteration; individual handlers read what they need.
    """

    session: Session
    tools: list[ToolPort] = field(default_factory=list)
    max_iterations: int = 20
    llm_adapter_name: str = ""
    permission_mode: str = "allow_all"
    cwd: Path | None = None
    # Pre-fetched skill listing: list of (name, description) tuples.
    # Populated by the caller before the REPL iteration so that _cmd_skills
    # can display skills without running an async call.
    skills_listing: list[tuple[str, str]] | None = None


# ---------------------------------------------------------------------------
# Public dispatcher
# ---------------------------------------------------------------------------


def handle(user_input: str, ctx: SlashCommandContext) -> str | None:
    """Dispatch *user_input* as a slash command.

    Returns the command output string if *user_input* starts with '/'.
    Returns None if *user_input* is not a slash command (caller should
    pass it to the agent as a normal message).
    """
    stripped = user_input.strip()
    if not stripped.startswith("/"):
        return None

    parts = stripped.split(maxsplit=1)
    command = parts[0].lower()

    match command:
        case "/help":
            return _cmd_help()
        case "/tools":
            return _cmd_tools(ctx)
        case "/memory":
            return _cmd_memory(ctx)
        case "/compact":
            return _cmd_compact(ctx)
        case "/budget":
            return _cmd_budget(ctx)
        case "/todo":
            return _cmd_todo(ctx)
        case "/status":
            return _cmd_status(ctx)
        case "/skills":
            return _cmd_skills(ctx)
        case "/init":
            return _cmd_init(ctx)
        case _:
            return f"Unknown command: {command!r}. Type /help for a list of commands."


# ---------------------------------------------------------------------------
# Command implementations
# ---------------------------------------------------------------------------


def _cmd_help() -> str:
    return _HELP_TEXT


def _cmd_tools(ctx: SlashCommandContext) -> str:
    if not ctx.tools:
        return "No tools loaded."
    lines = ["Loaded tools:", ""]
    for tool in ctx.tools:
        lines.append(f"  {tool.name:<24} [{tool.required_permission}]  {tool.description}")
    return "\n".join(lines)


def _cmd_memory(ctx: SlashCommandContext) -> str:
    s = ctx.session
    open_todos = sum(1 for t in s.todos if str(t.status) in ("pending", "in_progress"))
    lines = [
        f"Session ID  : {s.id}",
        f"Turns       : {s.turn_count}",
        f"Messages    : {len(s.messages)}",
        f"Tokens in   : {s.total_usage.input_tokens}",
        f"Tokens out  : {s.total_usage.output_tokens}",
        f"Open todos  : {open_todos}",
    ]
    return "\n".join(lines)


def _cmd_compact(ctx: SlashCommandContext) -> str:
    count = len(ctx.session.messages)
    ctx.session.messages.clear()
    return f"Context compacted: cleared {count} message(s) from conversation history."


def _cmd_budget(ctx: SlashCommandContext) -> str:
    used = ctx.session.turn_count
    limit = ctx.max_iterations
    remaining = max(0, limit - used)
    return f"Budget: {used} used / {remaining} remaining / {limit} limit"


def _cmd_todo(ctx: SlashCommandContext) -> str:
    todos = ctx.session.todos
    if not todos:
        return "No todos."
    lines = ["Todos:", ""]
    for item in todos:
        icon = _TODO_STATUS_ICONS.get(str(item.status), "?")
        lines.append(f"  {icon}  [{item.status:<11}]  {item.content}")
    return "\n".join(lines)


def _cmd_status(ctx: SlashCommandContext) -> str:
    s = ctx.session
    tool_names = [t.name for t in ctx.tools]
    lines = [
        "=== Ravn Agent Status ===",
        "",
        f"Session ID  : {s.id}",
        f"Turns       : {s.turn_count}",
        f"Messages    : {len(s.messages)}",
        f"Tokens in   : {s.total_usage.input_tokens}",
        f"Tokens out  : {s.total_usage.output_tokens}",
        f"Budget      : {s.turn_count} / {ctx.max_iterations}",
        f"LLM adapter : {ctx.llm_adapter_name or '(unknown)'}",
        f"Permission  : {ctx.permission_mode}",
        f"Tools ({len(tool_names):>2}) : {', '.join(tool_names) if tool_names else 'none'}",
        f"Todos       : {len(s.todos)}",
    ]
    return "\n".join(lines)


def _cmd_skills(ctx: SlashCommandContext) -> str:
    listing = ctx.skills_listing
    if listing is None:
        return (
            "Skill listing not available. "
            "Use the skill_list tool inside the agent to see available skills."
        )
    if not listing:
        return "No skills available. Add .md files to .ravn/skills/ to define skills."

    lines = [f"Skills ({len(listing)}):", ""]
    for name, description in listing:
        lines.append(f"  {name:<24}  {description}")
    return "\n".join(lines)


def _cmd_init(ctx: SlashCommandContext) -> str:
    cwd = ctx.cwd if ctx.cwd is not None else Path.cwd()
    ravn_md = cwd / "RAVN.md"
    if ravn_md.exists():
        return f"RAVN.md already exists at {ravn_md}. Remove it first to re-initialise."
    project_name = cwd.name
    content = _RAVN_MD_TEMPLATE.format(project_name=project_name)
    ravn_md.write_text(content, encoding="utf-8")
    return f"Bootstrapped RAVN.md at {ravn_md}"
