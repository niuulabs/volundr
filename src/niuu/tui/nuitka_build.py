"""Nuitka build configuration for the Textual TUI spike.

Run directly:  python -m niuu.tui.nuitka_build
Or use the flags with nuitka CLI directly (see NUITKA_FLAGS).

Findings and required workarounds are documented in NUITKA_SPIKE.md
at the repository root.
"""

from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path

# Nuitka flags validated during this spike.
# --onefile              : single binary distribution
# --standalone           : include Python runtime
# --follow-imports       : bundle all transitive imports
# --include-package=textual : ensure Textual's CSS + resources are bundled
# --include-package-data=textual : Textual ships .tcss default stylesheets
# --enable-plugin=no-qt  : suppress Qt binding warnings (not needed)
# --nofollow-import-to=pytest,_pytest : exclude test framework from binary
NUITKA_FLAGS: list[str] = [
    "--onefile",
    "--standalone",
    "--follow-imports",
    "--include-package=textual",
    "--include-package-data=textual",
    "--enable-plugin=no-qt",
    "--nofollow-import-to=pytest,_pytest",
]

ENTRY_POINT = Path(__file__).with_name("app.py")
OUTPUT_NAME = "niuu-tui-spike"


def build_command() -> list[str]:
    """Assemble the full nuitka compilation command."""
    cmd = [sys.executable, "-m", "nuitka"]
    cmd.extend(NUITKA_FLAGS)

    output = f"{OUTPUT_NAME}-{platform.system().lower()}-{platform.machine()}"
    cmd.extend([f"--output-filename={output}", str(ENTRY_POINT)])
    return cmd


def main() -> int:
    """Run the Nuitka build and return exit code."""
    cmd = build_command()
    print(f"Building with: {' '.join(cmd)}")
    result = subprocess.run(cmd, check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
