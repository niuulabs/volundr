"""Nuitka build configuration for the Niuu single-binary distribution.

Compiles all Python packages (cli, niuu, volundr, tyr, skuld) plus
bundled web UI assets, migration SQL files, and pgserver PostgreSQL
binaries into a single portable ``--onefile`` binary.

Usage::

    python -m cli.build                 # default: niuu binary
    python -m cli.build --name niuu-agent --entry src/cli/__main__.py

Parameterised via BINARY_NAME / ENTRY_POINT for future targets
(niuu-agent, niuu-reviewer, etc.).
"""

from __future__ import annotations

import argparse
import platform
import shlex
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Packages to include in the binary
INCLUDE_PACKAGES = [
    "cli",
    "niuu",
    "volundr",
    "tyr",
    "skuld",
    # FastAPI / uvicorn ecosystem (dynamically imported)
    "uvicorn",
    "uvicorn.lifespan",
    "uvicorn.loops",
    "uvicorn.protocols",
    "fastapi",
    "starlette",
    "pydantic",
    "pydantic_core",
    "anyio",
    "websockets",
]

# Package data to bundle (CSS, SQL, PostgreSQL binaries, etc.)
INCLUDE_PACKAGE_DATA = [
    "pgserver",
    "textual",
]

# Data directories mapped into the binary
DATA_DIR_MAPPINGS = [
    # Web UI assets → cli/web/dist inside the binary
    (REPO_ROOT / "src" / "cli" / "web" / "dist", "cli/web/dist"),
    # Volundr migrations
    (REPO_ROOT / "src" / "cli" / "migrations" / "volundr", "cli/migrations/volundr"),
    # Tyr migrations
    (REPO_ROOT / "src" / "cli" / "migrations" / "tyr", "cli/migrations/tyr"),
]

# Imports to exclude from the binary
NOFOLLOW_IMPORTS = [
    "pytest",
    "_pytest",
    "ruff",
    "respx",
]

DEFAULT_BINARY_NAME = "niuu"
DEFAULT_ENTRY_POINT = str(REPO_ROOT / "src" / "cli" / "__main__.py")
DEFAULT_OUTPUT_DIR = str(REPO_ROOT / "dist")


def platform_suffix() -> str:
    """Return ``{os}-{arch}`` suffix for the current platform."""
    os_name = platform.system().lower()
    machine = platform.machine().lower()
    # Normalise architecture names
    arch_map = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}
    arch = arch_map.get(machine, machine)
    return f"{os_name}-{arch}"


def build_command(
    binary_name: str = DEFAULT_BINARY_NAME,
    entry_point: str = DEFAULT_ENTRY_POINT,
    output_dir: str = DEFAULT_OUTPUT_DIR,
) -> list[str]:
    """Assemble the Nuitka compilation command."""
    cmd = [
        sys.executable,
        "-m",
        "nuitka",
        "--onefile",
        "--follow-imports",
        f"--output-dir={output_dir}",
        f"--output-filename={binary_name}-{platform_suffix()}",
        "--enable-plugin=no-qt",
    ]

    for pkg in INCLUDE_PACKAGES:
        cmd.append(f"--include-package={pkg}")

    for pkg in INCLUDE_PACKAGE_DATA:
        cmd.append(f"--include-package-data={pkg}")

    for src_dir, dest in DATA_DIR_MAPPINGS:
        if src_dir.is_dir() and any(src_dir.iterdir()):
            cmd.append(f"--include-data-dir={src_dir}={dest}")

    nofollow = ",".join(NOFOLLOW_IMPORTS)
    cmd.append(f"--nofollow-import-to={nofollow}")

    cmd.append(entry_point)
    return cmd


def main(argv: list[str] | None = None) -> int:
    """Parse args and run the Nuitka build."""
    parser = argparse.ArgumentParser(description="Build Niuu single-binary distribution")
    parser.add_argument(
        "--name",
        default=DEFAULT_BINARY_NAME,
        help=f"Binary name (default: {DEFAULT_BINARY_NAME})",
    )
    parser.add_argument(
        "--entry",
        default=DEFAULT_ENTRY_POINT,
        help=f"Entry point module (default: {DEFAULT_ENTRY_POINT})",
    )
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the command without running it",
    )

    args = parser.parse_args(argv)
    cmd = build_command(
        binary_name=args.name,
        entry_point=args.entry,
        output_dir=args.output_dir,
    )

    if args.dry_run:
        print(shlex.join(cmd))
        return 0

    print(f"Building {args.name} binary …")
    print(f"Command: {shlex.join(cmd)}")
    result = subprocess.run(cmd, check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
