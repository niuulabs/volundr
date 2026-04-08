"""Entry point for running the spike server directly or from a Nuitka binary.

Usage:
    python -m spikes.nuitka_fastapi          # development
    ./nuitka-fastapi-spike                   # from compiled binary
"""

from __future__ import annotations

import uvicorn

from spikes.nuitka_fastapi.app import app

HOST = "127.0.0.1"
PORT = 8099


def main() -> None:
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
