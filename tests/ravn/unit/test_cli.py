"""Unit tests for the Ravn CLI commands (supplemental coverage)."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from unittest.mock import MagicMock, patch

import pytest
from typer.testing import CliRunner

from ravn.cli.commands import _chat, app, main
from ravn.domain.models import (
    StreamEvent,
    StreamEventType,
    TokenUsage,
    TurnResult,
)

runner = CliRunner()


def _make_stream_fn(text: str = "ok"):
    async def _stream(*args, **kwargs) -> AsyncIterator[StreamEvent]:
        yield StreamEvent(type=StreamEventType.TEXT_DELTA, text=text)
        yield StreamEvent(
            type=StreamEventType.MESSAGE_DONE,
            usage=TokenUsage(input_tokens=5, output_tokens=3),
        )

    return _stream


class TestConfigFlag:
    def test_config_flag_sets_env_var(self, tmp_path) -> None:
        """--config sets RAVN_CONFIG before constructing Settings."""
        cfg = tmp_path / "custom.yaml"
        cfg.write_text("agent:\n  model: claude-custom\n")

        with (
            patch("ravn.cli.commands.AnthropicAdapter") as mock_cls,
            patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}),
        ):
            mock_adapter = MagicMock()
            mock_adapter.stream = _make_stream_fn()
            mock_cls.return_value = mock_adapter

            result = runner.invoke(app, ["Hello!", "--config", str(cfg)])

        assert result.exit_code == 0


class TestReplMode:
    async def test_repl_exits_on_eoferror(self) -> None:
        """EOFError (Ctrl+D) exits the REPL loop cleanly."""
        from unittest.mock import AsyncMock

        from ravn.adapters.cli_channel import CliChannel

        agent = MagicMock()
        agent.run_turn = AsyncMock(
            return_value=TurnResult(
                response="hi",
                tool_calls=[],
                tool_results=[],
                usage=TokenUsage(input_tokens=5, output_tokens=3),
            )
        )

        import io

        channel = CliChannel(file=io.StringIO())

        with patch("builtins.input", side_effect=EOFError):
            # Must complete without raising
            await _chat(agent, channel, prompt="", show_usage=False)

    async def test_repl_skips_empty_input(self) -> None:
        """Empty lines in REPL are skipped without calling run_turn."""
        from unittest.mock import AsyncMock

        from ravn.adapters.cli_channel import CliChannel

        agent = MagicMock()
        agent.run_turn = AsyncMock(
            return_value=TurnResult(
                response="hi",
                tool_calls=[],
                tool_results=[],
                usage=TokenUsage(input_tokens=5, output_tokens=3),
            )
        )

        import io

        channel = CliChannel(file=io.StringIO())

        # Empty input once, then EOFError to exit
        with patch("builtins.input", side_effect=["", EOFError]):
            await _chat(agent, channel, prompt="", show_usage=False)

        agent.run_turn.assert_not_called()

    async def test_repl_processes_message_then_exits(self) -> None:
        """A single message is processed before EOFError exits the REPL."""
        from unittest.mock import AsyncMock

        from ravn.adapters.cli_channel import CliChannel

        agent = MagicMock()
        agent.run_turn = AsyncMock(
            return_value=TurnResult(
                response="Hello!",
                tool_calls=[],
                tool_results=[],
                usage=TokenUsage(input_tokens=5, output_tokens=3),
            )
        )

        import io

        channel = CliChannel(file=io.StringIO())

        with patch("builtins.input", side_effect=["hi there", EOFError]):
            await _chat(agent, channel, prompt="", show_usage=False)

        agent.run_turn.assert_called_once_with("hi there")


class TestMainEntryPoint:
    def test_main_invokes_app(self) -> None:
        """main() is the package entry point — it delegates to the Typer app."""
        with patch("ravn.cli.commands.app") as mock_app:
            main()
            mock_app.assert_called_once()


class TestBuildAgentNoApiKey:
    def test_no_api_key_exits_with_error(self) -> None:
        """_build_agent raises typer.Exit(1) when no API key is configured."""
        import typer

        from ravn.cli.commands import _build_agent
        from ravn.config import Settings

        # Patch class-level method to return falsy — instance call delegates to class
        with patch.object(Settings, "effective_api_key", return_value=""):
            settings = Settings()
            with pytest.raises(typer.Exit):
                _build_agent(settings)


class TestRunTurnException:
    @pytest.mark.asyncio
    async def test_exception_is_caught_and_printed(self) -> None:
        """Exceptions in run_turn are caught; sys.exit called for single_turn."""
        import io
        from unittest.mock import AsyncMock

        from ravn.adapters.cli_channel import CliChannel
        from ravn.cli.commands import _run_turn

        agent = MagicMock()
        agent.run_turn = AsyncMock(side_effect=RuntimeError("boom"))
        channel = CliChannel(file=io.StringIO())

        # In REPL mode (single_turn=False), no sys.exit — just prints error
        with patch("typer.echo") as mock_echo:
            await _run_turn(agent, channel, "hello", show_usage=False, single_turn=False)
        mock_echo.assert_called_once()
        assert "boom" in mock_echo.call_args[0][0]

    @pytest.mark.asyncio
    async def test_single_turn_exception_calls_sys_exit(self) -> None:
        """In single_turn mode, an exception causes sys.exit(1)."""
        import io
        import sys
        from unittest.mock import AsyncMock

        from ravn.adapters.cli_channel import CliChannel
        from ravn.cli.commands import _run_turn

        agent = MagicMock()
        agent.run_turn = AsyncMock(side_effect=RuntimeError("fatal"))
        channel = CliChannel(file=io.StringIO())

        with (
            patch("typer.echo"),
            patch.object(sys, "exit") as mock_exit,
        ):
            await _run_turn(agent, channel, "hello", show_usage=False, single_turn=True)
        mock_exit.assert_called_once_with(1)


class TestPrintUsage:
    def test_print_usage_with_cache_tokens(self) -> None:
        """_print_usage includes cache_read and cache_write when non-zero."""
        from ravn.cli.commands import _print_usage
        from ravn.domain.models import TokenUsage

        usage = TokenUsage(
            input_tokens=10,
            output_tokens=5,
            cache_read_tokens=100,
            cache_write_tokens=200,
        )
        with patch("typer.echo") as mock_echo:
            _print_usage(usage)
        msg = mock_echo.call_args[0][0]
        assert "cache_read=100" in msg
        assert "cache_write=200" in msg

    def test_print_usage_without_cache_tokens(self) -> None:
        """_print_usage omits cache fields when zero."""
        from ravn.cli.commands import _print_usage
        from ravn.domain.models import TokenUsage

        usage = TokenUsage(input_tokens=10, output_tokens=5)
        with patch("typer.echo") as mock_echo:
            _print_usage(usage)
        msg = mock_echo.call_args[0][0]
        assert "cache" not in msg
        assert "in=10" in msg
        assert "out=5" in msg
