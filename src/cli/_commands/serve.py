"""``niuu serve`` — serve the web UI."""

from __future__ import annotations

import argparse

from cli.resources import web_dist_dir


def execute(args: argparse.Namespace) -> int:
    """Serve the bundled web UI via a simple HTTP server."""
    try:
        dist = web_dist_dir()
    except FileNotFoundError as exc:
        print(f"Error: {exc}")
        return 1

    port = args.port
    print(f"Serving web UI from {dist} on port {port}")
    # TODO: wire up a proper static file server
    return 0
