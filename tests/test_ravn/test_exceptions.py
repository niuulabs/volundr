"""Tests for Ravn domain exceptions."""

from __future__ import annotations

from ravn.domain.exceptions import (
    ConfigurationError,
    LLMError,
    MaxIterationsError,
    PermissionDeniedError,
    RavnError,
    ToolExecutionError,
)


class TestRavnError:
    def test_is_exception(self) -> None:
        e = RavnError("base error")
        assert isinstance(e, Exception)
        assert str(e) == "base error"


class TestPermissionDeniedError:
    def test_fields(self) -> None:
        e = PermissionDeniedError("echo", "tool:echo")
        assert e.tool_name == "echo"
        assert e.permission == "tool:echo"
        assert "echo" in str(e)
        assert "tool:echo" in str(e)

    def test_is_ravn_error(self) -> None:
        e = PermissionDeniedError("x", "y")
        assert isinstance(e, RavnError)


class TestToolExecutionError:
    def test_fields(self) -> None:
        cause = ValueError("bad input")
        e = ToolExecutionError("my_tool", cause)
        assert e.tool_name == "my_tool"
        assert e.cause is cause
        assert "my_tool" in str(e)

    def test_is_ravn_error(self) -> None:
        e = ToolExecutionError("t", Exception())
        assert isinstance(e, RavnError)


class TestLLMError:
    def test_without_status_code(self) -> None:
        e = LLMError("connection failed")
        assert e.status_code is None
        assert str(e) == "connection failed"

    def test_with_status_code(self) -> None:
        e = LLMError("rate limited", status_code=429)
        assert e.status_code == 429

    def test_is_ravn_error(self) -> None:
        e = LLMError("x")
        assert isinstance(e, RavnError)


class TestMaxIterationsError:
    def test_fields(self) -> None:
        e = MaxIterationsError(20)
        assert e.max_iterations == 20
        assert "20" in str(e)

    def test_is_ravn_error(self) -> None:
        e = MaxIterationsError(5)
        assert isinstance(e, RavnError)


class TestConfigurationError:
    def test_is_ravn_error(self) -> None:
        e = ConfigurationError("bad config")
        assert isinstance(e, RavnError)
