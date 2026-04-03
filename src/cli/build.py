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

import platform
import shlex
import subprocess
import sys
from pathlib import Path

import typer

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
    # Rich unicode data modules are dynamically imported by version string
    "rich._unicode_data",
]

# Package data to bundle (CSS, SQL, PostgreSQL binaries, etc.)
INCLUDE_PACKAGE_DATA = [
    "cli",
    "pgserver",
    "rich",
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

    # pgserver bundles native PostgreSQL binaries and shared libraries.
    # Nuitka's --include-package-data skips .dylib/.so files, so we
    # include the entire pgserver directory tree explicitly.
    try:
        import pgserver

        pg_root = Path(pgserver.__file__).parent
        for path in pg_root.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix in (".py", ".pyc", ".pyi"):
                continue  # already handled by --include-package
            rel = path.relative_to(pg_root)
            # Skip if already included by --include-package-data
            # (non-binary files are handled there)
            if path.suffix in (".dylib", ".so", ".a"):
                cmd.append(f"--include-data-files={path}=pgserver/{rel}")
    except ImportError:
        pass

    nofollow = ",".join(NOFOLLOW_IMPORTS)
    cmd.append(f"--nofollow-import-to={nofollow}")

    cmd.append(entry_point)
    return cmd


def _copy_pgserver_dylibs(output_dir: str) -> None:
    """Copy pgserver's .dylibs directory into the standalone dist.

    Nuitka's --include-package-data skips hidden directories (those starting
    with '.'), but pgserver's PostgreSQL binaries reference dylibs via
    @loader_path relative paths into .dylibs/. Copy them manually.
    """
    import shutil

    dist_dir = Path(output_dir) / "__main__.dist"
    target = dist_dir / "pgserver" / ".dylibs"
    if target.exists():
        return

    # Find source .dylibs in the venv
    try:
        import pgserver

        src = Path(pgserver.__file__).parent / ".dylibs"
        if src.is_dir():
            shutil.copytree(src, target)
            typer.echo(f"Copied pgserver .dylibs → {target}")
    except (ImportError, FileNotFoundError):
        typer.echo("Warning: could not copy pgserver .dylibs")


build_cli = typer.Typer()


@build_cli.command()
def main(
    name: str = typer.Option(
        DEFAULT_BINARY_NAME, help=f"Binary name (default: {DEFAULT_BINARY_NAME})"
    ),
    entry: str = typer.Option(DEFAULT_ENTRY_POINT, help="Entry point module"),
    output_dir: str = typer.Option(DEFAULT_OUTPUT_DIR, "--output-dir", help="Output directory"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print command without running"),
) -> None:
    """Build Niuu single-binary distribution."""
    cmd = build_command(binary_name=name, entry_point=entry, output_dir=output_dir)

    if dry_run:
        typer.echo(shlex.join(cmd))
        raise typer.Exit()

    typer.echo(f"Building {name} binary …")
    typer.echo(f"Command: {shlex.join(cmd)}")
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise typer.Exit(result.returncode)

    # Copy pgserver .dylibs (hidden dir filtered by Nuitka --include-package-data)
    _copy_pgserver_dylibs(output_dir)

    raise typer.Exit(0)


if __name__ == "__main__":
    build_cli()
