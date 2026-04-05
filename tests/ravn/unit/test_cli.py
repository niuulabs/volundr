"""Unit tests for the Ravn CLI commands (supplemental coverage)."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from unittest.mock import MagicMock, patch

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
