"""Allow running niuu CLI as ``python -m cli``."""

from cli.app import build_app


def main() -> None:
    """Entry point for the niuu CLI."""
    app = build_app()
    app()


if __name__ == "__main__":
    main()
