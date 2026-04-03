"""``niuu serve`` — serve the web UI."""

from __future__ import annotations

from cli.resources import web_dist_dir


def execute(port: int = 5174) -> int:
    """Serve the bundled web UI via a simple HTTP server."""
    try:
        dist = web_dist_dir()
    except FileNotFoundError as exc:
        print(f"Error: {exc}")
        return 1

    print(f"Serving web UI from {dist} on port {port}")
    # TODO: wire up a proper static file server
    return 0
