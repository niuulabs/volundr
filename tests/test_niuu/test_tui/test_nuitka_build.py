"""Tests for the Nuitka build configuration module."""

from __future__ import annotations

import platform
from unittest.mock import patch

from niuu.tui.nuitka_build import NUITKA_FLAGS, build_command, main


def test_nuitka_flags_contains_onefile() -> None:
    assert "--onefile" in NUITKA_FLAGS


def test_nuitka_flags_contains_textual_package() -> None:
    assert "--include-package=textual" in NUITKA_FLAGS


def test_nuitka_flags_contains_textual_data() -> None:
    assert "--include-package-data=textual" in NUITKA_FLAGS


def test_nuitka_flags_excludes_pytest() -> None:
    assert "--nofollow-import-to=pytest,_pytest" in NUITKA_FLAGS


def test_build_command_includes_output_filename() -> None:
    cmd = build_command()
    system = platform.system().lower()
    machine = platform.machine()
    expected_flag = f"--output-filename=niuu-tui-spike-{system}-{machine}"
    assert expected_flag in cmd


def test_build_command_includes_entry_point() -> None:
    cmd = build_command()
    assert cmd[-1].endswith("app.py")


def test_build_command_starts_with_python_nuitka() -> None:
    cmd = build_command()
    assert cmd[0].endswith("python") or "python" in cmd[0]
    assert cmd[1] == "-m"
    assert cmd[2] == "nuitka"


def test_main_returns_subprocess_exit_code() -> None:
    with patch("niuu.tui.nuitka_build.subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        assert main() == 0

        mock_run.return_value.returncode = 1
        assert main() == 1
