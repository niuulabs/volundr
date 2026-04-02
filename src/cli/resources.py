"""Access embedded resources (web UI assets, migration SQL files).

In development these are read from the filesystem.  When compiled into a
Nuitka ``--onefile`` binary the files are bundled as package data and
accessed via :mod:`importlib.resources`.
"""

from __future__ import annotations

import importlib.resources
from pathlib import Path


def web_dist_dir() -> Path:
    """Return the path to the bundled web UI ``dist/`` directory.

    Falls back to the repository ``web/dist`` when running from source.
    """
    pkg_dir = importlib.resources.files("cli") / "web" / "dist"
    pkg_path = _resource_path(pkg_dir)
    if pkg_path.is_dir():
        return pkg_path

    # Fallback: repo-relative for development
    repo_web = Path(__file__).resolve().parents[2] / "web" / "dist"
    if repo_web.is_dir():
        return repo_web

    msg = "Web UI assets not found — run 'make build-web' first"
    raise FileNotFoundError(msg)


def migration_dir(variant: str = "volundr") -> Path:
    """Return the path to embedded SQL migration files.

    Parameters
    ----------
    variant:
        ``"volundr"`` (default) for main migrations, ``"tyr"`` for Tyr.
    """
    if variant == "tyr":
        pkg_dir = importlib.resources.files("cli") / "migrations" / "tyr"
    else:
        pkg_dir = importlib.resources.files("cli") / "migrations" / "volundr"

    resolved = _resource_path(pkg_dir)
    if resolved.is_dir():
        return resolved

    # Fallback: repo-relative
    if variant == "tyr":
        repo_dir = Path(__file__).resolve().parents[2] / "migrations" / "tyr"
    else:
        repo_dir = Path(__file__).resolve().parents[2] / "migrations"

    if repo_dir.is_dir():
        return repo_dir

    msg = f"Migration files not found for variant={variant!r}"
    raise FileNotFoundError(msg)


def _resource_path(traversable: importlib.resources.abc.Traversable) -> Path:
    """Convert an importlib Traversable to a concrete Path."""
    # In Python 3.12+ ``as_posix()`` + Path works for both filesystem and
    # zip-backed resources.  For Nuitka onefile the resources are extracted
    # to a temp directory, so ``str()`` gives a real filesystem path.
    return Path(str(traversable))
