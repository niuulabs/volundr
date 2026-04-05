"""Ravn CLI entry point."""

from __future__ import annotations

import asyncio
import sys

import typer

from ravn.adapters.anthropic_adapter import AnthropicAdapter
from ravn.adapters.approval_memory import ApprovalMemory
from ravn.adapters.cli_channel import CliChannel
from ravn.adapters.permission_adapter import AllowAllPermission, DenyAllPermission
from ravn.adapters.slash_commands import SlashCommandContext
from ravn.adapters.slash_commands import handle as handle_slash
from ravn.agent import RavnAgent
from ravn.config import Settings
from ravn.domain.models import TokenUsage

app = typer.Typer(
    name="ravn",
    help="Ravn — conversational AI agent with tool calling.",
    add_completion=False,
)

approvals_app = typer.Typer(
    name="ravn-approvals",
    help="Manage per-project command approval patterns.",
    add_completion=False,
)


def approvals_main() -> None:
    approvals_app()


def _build_agent(settings: Settings, *, no_tools: bool = False) -> tuple[RavnAgent, CliChannel]:
    api_key = settings.effective_api_key()
    if not api_key:
        typer.echo(
            "Error: No API key found. Set ANTHROPIC_API_KEY or configure ravn.yaml.",
            err=True,
        )
        raise typer.Exit(1)

    llm = AnthropicAdapter(
        api_key=api_key,
        base_url=settings.anthropic.base_url,
        model=settings.agent.model,
        max_tokens=settings.agent.max_tokens,
        max_retries=settings.llm_adapter.max_retries,
        retry_base_delay=settings.llm_adapter.retry_base_delay,
        timeout=settings.llm_adapter.timeout,
    )

    channel = CliChannel()

    permission = DenyAllPermission() if no_tools else AllowAllPermission()

    agent = RavnAgent(
        llm=llm,
        tools=[],
        channel=channel,
        permission=permission,
        system_prompt=settings.agent.system_prompt,
        model=settings.agent.model,
        max_tokens=settings.agent.max_tokens,
        max_iterations=settings.agent.max_iterations,
    )

    return agent, channel


def _make_slash_ctx(agent: RavnAgent, settings: Settings) -> SlashCommandContext:
    """Build a SlashCommandContext from the running agent and loaded settings."""
    return SlashCommandContext(
        session=agent.session,
        tools=agent.tools,
        max_iterations=agent.max_iterations,
        llm_adapter_name=agent.llm_adapter_name,
        permission_mode=settings.permission.mode,
    )


@app.command()
def run(
    prompt: str = typer.Argument(default="", help="Initial prompt. If empty, starts REPL."),
    no_tools: bool = typer.Option(False, "--no-tools", help="Disable all tool execution."),
    show_usage: bool = typer.Option(False, "--show-usage", help="Print token usage after turn."),
    config: str = typer.Option("", "--config", "-c", help="Path to ravn config YAML."),
) -> None:
    """Start a Ravn conversation. Pass a prompt for single-turn, or omit for REPL."""
    import os

    if config:
        os.environ["RAVN_CONFIG"] = config

    settings = Settings()
    agent, channel = _build_agent(settings, no_tools=no_tools)

    asyncio.run(_chat(agent, channel, settings=settings, prompt=prompt, show_usage=show_usage))


async def _chat(
    agent: RavnAgent,
    channel: CliChannel,
    *,
    settings: Settings,
    prompt: str,
    show_usage: bool,
) -> None:
    """Run a single-turn or multi-turn conversation."""
    if prompt:
        # Single-turn: slash commands are not meaningful here; pass straight to agent.
        await _run_turn(agent, channel, prompt, show_usage=show_usage, single_turn=True)
        return

    # REPL mode.
    typer.echo("Ravn — type your message or /help for commands. Ctrl+D to exit.\n")
    slash_ctx = _make_slash_ctx(agent, settings)
    while True:
        try:
            user_input = input("You: ").strip()
        except EOFError:
            break

        if not user_input:
            continue

        slash_output = handle_slash(user_input, slash_ctx)
        if slash_output is not None:
            typer.echo(slash_output)
            continue

        await _run_turn(agent, channel, user_input, show_usage=show_usage)


async def _run_turn(
    agent: RavnAgent,
    channel: CliChannel,
    user_input: str,
    *,
    show_usage: bool,
    single_turn: bool = False,
) -> None:
    try:
        result = await agent.run_turn(user_input)
        channel.finish()
        if show_usage:
            _print_usage(result.usage)
    except Exception as exc:
        channel.finish()
        typer.echo(f"\n[error] {exc}", err=True)
        if single_turn:
            sys.exit(1)


def _print_usage(usage: TokenUsage) -> None:
    parts = [f"in={usage.input_tokens}", f"out={usage.output_tokens}"]
    if usage.cache_read_tokens:
        parts.append(f"cache_read={usage.cache_read_tokens}")
    if usage.cache_write_tokens:
        parts.append(f"cache_write={usage.cache_write_tokens}")
    typer.echo(f"[tokens] {', '.join(parts)}")


@approvals_app.command("list")
def approvals_list() -> None:
    """List all stored approval patterns for the current project."""
    memory = ApprovalMemory()
    entries = memory.list_entries()
    if not entries:
        typer.echo("No approval patterns stored.")
        return
    typer.echo(f"Approval patterns ({len(entries)}):\n")
    for entry in entries:
        auto = entry.auto_approved_count
        typer.echo(f"  {entry.command!r}")
        typer.echo(f"    pattern      : {entry.pattern}")
        typer.echo(f"    approved_at  : {entry.approved_at}")
        typer.echo(f"    auto-approved: {auto} time(s)\n")


@approvals_app.command("revoke")
def approvals_revoke(
    pattern: str = typer.Argument(help="Command text or pattern to revoke."),
) -> None:
    """Revoke an approval pattern so the command will be prompted again."""
    memory = ApprovalMemory()
    removed = memory.revoke(pattern)
    if removed:
        typer.echo(f"Revoked: {pattern!r}")
    else:
        typer.echo(f"No matching approval found for {pattern!r}", err=True)
        raise typer.Exit(1)


def main() -> None:
    app()
