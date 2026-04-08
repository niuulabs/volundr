"""Tests for niuu.cli_output helpers."""

from __future__ import annotations

from io import StringIO
from unittest.mock import patch

import httpx
import pytest
import typer

from niuu.cli_output import (
    format_api_error,
    handle_api_error,
    handle_transport_error,
    print_error,
    print_json,
    print_success,
    print_table,
)


class TestPrintTable:
    def test_renders_rows(self) -> None:
        with patch("niuu.cli_output.stdout_console.print") as mock_print:
            print_table(
                columns=[("id", "ID"), ("name", "Name")],
                rows=[{"id": "1", "name": "alpha"}, {"id": "2", "name": "beta"}],
            )
            mock_print.assert_called_once()
            table = mock_print.call_args[0][0]
            assert table.row_count == 2

    def test_empty_rows(self) -> None:
        with patch("niuu.cli_output.stdout_console.print") as mock_print:
            print_table(columns=[("id", "ID")], rows=[])
            mock_print.assert_called_once()
            table = mock_print.call_args[0][0]
            assert table.row_count == 0

    def test_missing_keys_render_empty(self) -> None:
        with patch("niuu.cli_output.stdout_console.print") as mock_print:
            print_table(
                columns=[("id", "ID"), ("missing", "Missing")],
                rows=[{"id": "1"}],
            )
            table = mock_print.call_args[0][0]
            assert table.row_count == 1


class TestPrintJson:
    def test_outputs_valid_json(self) -> None:
        buf = StringIO()
        with patch("sys.stdout", buf):
            print_json({"key": "value"})
        output = buf.getvalue()
        assert '"key": "value"' in output

    def test_handles_list(self) -> None:
        buf = StringIO()
        with patch("sys.stdout", buf):
            print_json([1, 2, 3])
        assert "[" in buf.getvalue()


class TestPrintSuccess:
    def test_calls_console(self) -> None:
        with patch("niuu.cli_output.stdout_console.print") as mock_print:
            print_success("done")
            mock_print.assert_called_once()


class TestPrintError:
    def test_calls_stderr_console(self) -> None:
        with patch("niuu.cli_output.console.print") as mock_print:
            print_error("oops")
            mock_print.assert_called_once()


class TestFormatApiError:
    def test_401(self) -> None:
        msg = format_api_error(401, "")
        assert "login" in msg.lower()

    def test_403(self) -> None:
        msg = format_api_error(403, "")
        assert "denied" in msg.lower()

    def test_404(self) -> None:
        msg = format_api_error(404, "session abc")
        assert "session abc" in msg

    def test_500(self) -> None:
        msg = format_api_error(500, "internal")
        assert "500" in msg


class TestHandleApiError:
    def test_exits_with_code_1(self) -> None:
        request = httpx.Request("GET", "http://test/api")
        response = httpx.Response(401, json={"detail": "bad token"}, request=request)
        exc = httpx.HTTPStatusError("err", request=request, response=response)
        with pytest.raises(typer.Exit) as exit_info:
            handle_api_error(exc)
        assert exit_info.value.exit_code == 1

    def test_handles_non_json_response(self) -> None:
        request = httpx.Request("GET", "http://test/api")
        response = httpx.Response(500, text="plain error", request=request)
        exc = httpx.HTTPStatusError("err", request=request, response=response)
        with pytest.raises(typer.Exit):
            handle_api_error(exc)


class TestHandleTransportError:
    def test_exits_with_code_1(self) -> None:
        with pytest.raises(typer.Exit) as exit_info:
            handle_transport_error("Volundr")
        assert exit_info.value.exit_code == 1
