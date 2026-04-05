"""Ravn CLI entry point."""

from __future__ import annotations

import asyncio
import sys

import typer

from ravn.adapters.anthropic_adapter import AnthropicAdapter
from ravn.adapters.cli_channel import CliChannel
from ravn.adapters.permission_adapter import AllowAllPermission, DenyAllPermission
from ravn.agent import RavnAgent
from ravn.config import Settings
from ravn.domain.models import TokenUsage

app = typer.Typer(
    name="ravn",
    help="Ravn — conversational AI agent with tool calling.",
    add_completion=False,
)


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

    asyncio.run(_chat(agent, channel, prompt=prompt, show_usage=show_usage))


async def _chat(
    agent: RavnAgent,
    channel: CliChannel,
    *,
    prompt: str,
    show_usage: bool,
) -> None:
    """Run a single-turn or multi-turn conversation."""
    if prompt:
        await _run_turn(agent, channel, prompt, show_usage=show_usage)
        return

    # REPL mode.
    typer.echo("Ravn — type your message, Ctrl+D to exit.\n")
    while True:
        try:
            user_input = input("You: ").strip()
        except EOFError:
            break

        if not user_input:
            continue

        await _run_turn(agent, channel, user_input, show_usage=show_usage)


async def _run_turn(
    agent: RavnAgent,
    channel: CliChannel,
    user_input: str,
    *,
    show_usage: bool,
) -> None:
    try:
        result = await agent.run_turn(user_input)
        channel.finish()
        if show_usage:
            _print_usage(result.usage)
    except Exception as exc:
        channel.finish()
        typer.echo(f"\n[error] {exc}", err=True)
        sys.exit(1)


def _print_usage(usage: TokenUsage) -> None:
    parts = [f"in={usage.input_tokens}", f"out={usage.output_tokens}"]
    if usage.cache_read_tokens:
        parts.append(f"cache_read={usage.cache_read_tokens}")
    if usage.cache_write_tokens:
        parts.append(f"cache_write={usage.cache_write_tokens}")
    typer.echo(f"[tokens] {', '.join(parts)}")


def main() -> None:
    app()
