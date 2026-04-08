"""Slash command dispatcher for the Ravn CLI.

Slash commands let users inspect and control the running agent without
breaking the conversational flow.  Every command starts with '/' and is
handled synchronously, returning a formatted string to be printed by the
caller.

Commands
--------
/help           — list all slash commands and active tools
/tools          — show loaded tool registry with permission levels
/memory         — show episodic memory summary for this session
/compact        — clear conversation history to reclaim context budget
/budget         — show iteration budget: used / remaining / limit
/todo           — show current todo list
/status         — full agent state dump
/init           — bootstrap a RAVN.md in the current working directory
/checkpoint             — save a checkpoint snapshot now (optional label)
/checkpoint list        — list checkpoints for the current task
/checkpoint restore <id>— restore session to a named checkpoint
/checkpoint delete <id> — delete a named checkpoint
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path

from ravn.domain.checkpoint import restore_session_from_checkpoint
from ravn.domain.models import Session
from ravn.ports.checkpoint import CheckpointPort
from ravn.ports.tool import ToolPort

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_HELP_TEXT = """\
Ravn slash commands:

  /help                    — show this help message
  /tools                   — show loaded tool registry with permission levels
  /memory                  — show episodic memory summary for this session
  /compact                 — clear conversation history to reclaim context budget
  /budget                  — show iteration budget: used / remaining / limit
  /todo                    — show current todo list
  /status                  — full agent state dump
  /skills                  — list all available skills
  /init                    — bootstrap a RAVN.md in the current directory
  /checkpoint [label]      — save a checkpoint snapshot (optional label)
  /checkpoint list         — list checkpoints for the current task
  /checkpoint restore <id> — restore session to a named checkpoint
  /checkpoint delete <id>  — delete a named checkpoint\
"""

# Per-type overrides: (notes, iteration_budget, extra_tools).
# Everything else is shared via _build_ravn_template().
_PROJECT_TYPE_SPECS: dict[str, tuple[str, int, list[str]]] = {
    "python": (
        (
            "Python project. Python 3.12+ style preferred.\n"
            "  Run tests with: pytest -x\n"
            "  Lint with: ruff check . && ruff format .\n"
            "  Always type-annotate function signatures.\n"
            "  Use X | None instead of Optional[X]."
        ),
        30,
        ["todo"],
    ),
    "go": (
        (
            "Go project.\n"
            "  Run tests with: go test ./...\n"
            "  Format with: gofmt -w .\n"
            "  Lint with: golangci-lint run\n"
            "  Follow standard Go idioms and error handling patterns."
        ),
        30,
        ["todo"],
    ),
    "node": (
        (
            "Node.js project.\n"
            "  Run tests with: npm test\n"
            "  Lint/format with: npm run lint\n"
            "  Always type-annotate if TypeScript is used."
        ),
        30,
        ["todo"],
    ),
    "rust": (
        (
            "Rust project.\n"
            "  Run tests with: cargo test\n"
            "  Format with: cargo fmt\n"
            "  Lint with: cargo clippy\n"
            "  Prefer idiomatic Rust — use Result/Option, avoid unwrap() in library code."
        ),
        30,
        ["todo"],
    ),
    "generic": (
        "Add project-specific instructions here.\n  Ravn will include these in its system prompt.",
        20,
        [],
    ),
}

_BASE_TOOLS = ["file", "git", "terminal", "web"]


def _build_ravn_template(
    project_name: str,
    notes: str,
    iteration_budget: int = 20,
    extra_tools: list[str] | None = None,
) -> str:
    """Build a RAVN.md file content string from the shared schema."""
    tools = _BASE_TOOLS + (extra_tools or [])
    tools_yaml = "[" + ", ".join(tools) + "]"
    return (
        f"# RAVN Project: {project_name}\n"
        "\n"
        "persona: coding-agent\n"
        f"allowed_tools: {tools_yaml}\n"
        "forbidden_tools: []\n"
        "permission_mode: workspace_write\n"
        "primary_alias: balanced\n"
        "thinking_enabled: false\n"
        f"iteration_budget: {iteration_budget}\n"
        "notes: >\n"
        f"  {notes}\n"
    )


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
    # NIU-537: checkpoint port and task_id for /checkpoint commands.
    checkpoint_port: CheckpointPort | None = None
    task_id: str = ""


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
        case "/checkpoint":
            args = parts[1].strip() if len(parts) > 1 else ""
            return _cmd_checkpoint(ctx, args)
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


def _detect_project_type(cwd: Path) -> str:
    """Return a project type string by inspecting files in *cwd*.

    Checks for well-known marker files and returns one of:
    ``"python"``, ``"go"``, ``"node"``, ``"rust"``, or ``"generic"``.
    """
    markers: list[tuple[str, list[str]]] = [
        ("python", ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"]),
        ("go", ["go.mod"]),
        ("rust", ["Cargo.toml"]),
        ("node", ["package.json"]),
    ]
    for project_type, files in markers:
        if any((cwd / f).exists() for f in files):
            return project_type
    return "generic"


def _cmd_init(ctx: SlashCommandContext) -> str:
    cwd = ctx.cwd if ctx.cwd is not None else Path.cwd()
    ravn_md = cwd / "RAVN.md"
    if ravn_md.exists():
        return f"RAVN.md already exists at {ravn_md}. Remove it first to re-initialise."
    project_name = cwd.name
    project_type = _detect_project_type(cwd)
    notes, budget, extra_tools = _PROJECT_TYPE_SPECS[project_type]
    content = _build_ravn_template(project_name, notes, budget, extra_tools)
    ravn_md.write_text(content, encoding="utf-8")
    return f"Bootstrapped RAVN.md at {ravn_md} (detected project type: {project_type})"


# ---------------------------------------------------------------------------
# /checkpoint command
# ---------------------------------------------------------------------------


def _cmd_checkpoint(ctx: SlashCommandContext, args: str) -> str:
    """Dispatch /checkpoint subcommands.

    Subcommands:
        (no args)          — save a checkpoint now (no label)
        <label>            — save a checkpoint with the given label
        list               — list checkpoints for the current task
        restore <id>       — restore session to a named checkpoint
        delete <id>        — delete a named checkpoint
    """
    if ctx.checkpoint_port is None:
        return "Checkpoint port not configured. Enable checkpointing in ravn.yaml."

    sub_parts = args.split(maxsplit=1)
    subcommand = sub_parts[0].lower() if sub_parts else ""

    match subcommand:
        case "list":
            return _checkpoint_list(ctx)
        case "restore":
            ckpt_id = sub_parts[1].strip() if len(sub_parts) > 1 else ""
            return _checkpoint_restore(ctx, ckpt_id)
        case "delete":
            ckpt_id = sub_parts[1].strip() if len(sub_parts) > 1 else ""
            return _checkpoint_delete(ctx, ckpt_id)
        case _:
            # Treat args as optional label
            return _checkpoint_save(ctx, label=args.strip())


def _run_async(coro: object) -> object:
    """Run an async coroutine from a synchronous context."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(asyncio.run, coro)
                return future.result(timeout=30)
        return loop.run_until_complete(coro)
    except RuntimeError:
        return asyncio.run(coro)


def _checkpoint_save(ctx: SlashCommandContext, label: str = "") -> str:
    from datetime import UTC, datetime

    from ravn.domain.checkpoint import Checkpoint

    assert ctx.checkpoint_port is not None

    messages = [{"role": m.role, "content": m.content} for m in ctx.session.messages]
    todos = [
        {"id": t.id, "content": t.content, "status": str(t.status), "priority": t.priority}
        for t in ctx.session.todos
    ]
    checkpoint = Checkpoint(
        task_id=ctx.task_id or str(ctx.session.id),
        user_input="",
        messages=messages,
        todos=todos,
        iteration_budget_consumed=0,
        iteration_budget_total=0,
        last_tool_call=None,
        last_tool_result=None,
        partial_response="",
        interrupted_by=None,
        created_at=datetime.now(UTC),
        label=label,
    )
    try:
        checkpoint_id = _run_async(ctx.checkpoint_port.save_snapshot(checkpoint))
    except Exception as exc:
        return f"Checkpoint save failed: {exc}"

    label_note = f" (label: {label!r})" if label else ""
    return f"Checkpoint saved{label_note}.\ncheckpoint_id: {checkpoint_id}"


def _checkpoint_list(ctx: SlashCommandContext) -> str:
    assert ctx.checkpoint_port is not None
    task_id = ctx.task_id or str(ctx.session.id)
    try:
        snapshots = _run_async(ctx.checkpoint_port.list_for_task(task_id))
    except Exception as exc:
        return f"Checkpoint list failed: {exc}"

    if not snapshots:
        return f"No checkpoints found for task {task_id!r}."

    lines = [f"Checkpoints for task {task_id!r} ({len(snapshots)} total):", ""]
    for cp in snapshots:
        label_part = f"  label: {cp.label}" if cp.label else ""
        ts = cp.created_at.strftime("%Y-%m-%dT%H:%M:%SZ")
        lines.append(f"  {cp.checkpoint_id}  seq={cp.seq}  {ts}")
        if label_part:
            lines.append(f"  {label_part}")
    return "\n".join(lines)


def _checkpoint_restore(ctx: SlashCommandContext, checkpoint_id: str) -> str:
    if not checkpoint_id:
        return "Usage: /checkpoint restore <checkpoint_id>"

    assert ctx.checkpoint_port is not None
    try:
        cp = _run_async(ctx.checkpoint_port.load_snapshot(checkpoint_id))
    except Exception as exc:
        return f"Checkpoint restore failed: {exc}"

    if cp is None:
        return f"Checkpoint {checkpoint_id!r} not found."

    restore_session_from_checkpoint(ctx.session, cp)

    return (
        f"Restored from {checkpoint_id!r}.\n"
        f"  Messages: {len(ctx.session.messages)}\n"
        f"  Todos: {len(ctx.session.todos)}\n"
        f"  Created: {cp.created_at.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    )


def _checkpoint_delete(ctx: SlashCommandContext, checkpoint_id: str) -> str:
    if not checkpoint_id:
        return "Usage: /checkpoint delete <checkpoint_id>"

    assert ctx.checkpoint_port is not None
    try:
        _run_async(ctx.checkpoint_port.delete_snapshot(checkpoint_id))
    except Exception as exc:
        return f"Checkpoint delete failed: {exc}"

    return f"Checkpoint {checkpoint_id!r} deleted."
