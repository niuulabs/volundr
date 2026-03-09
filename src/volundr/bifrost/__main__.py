"""CLI entry point for Bifröst.

Usage::

    python -m volundr.bifrost
    python -m volundr.bifrost --port 8200
    python -m volundr.bifrost --config /path/to/bifrost.yaml
    python -m volundr.bifrost --upstream https://api.anthropic.com
"""

from __future__ import annotations

import argparse
import logging

import uvicorn

from volundr.bifrost.config import BifrostConfig, load_config


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="bifrost",
        description="Bifröst — cognitive proxy for Claude Code",
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Path to bifrost.yaml configuration file",
    )
    parser.add_argument(
        "--host",
        type=str,
        default=None,
        help="Bind address (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Bind port (default: 8200)",
    )
    parser.add_argument(
        "--upstream",
        type=str,
        default=None,
        help="Upstream API URL (default: https://api.anthropic.com)",
    )
    parser.add_argument(
        "--auth-mode",
        type=str,
        choices=["passthrough", "api_key"],
        default=None,
        help="Auth mode for upstream (default: passthrough)",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Log level (default: info)",
    )

    args = parser.parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    )

    config = load_config(args.config)

    # CLI overrides
    if args.host is not None:
        config = _with_host(config, args.host)
    if args.port is not None:
        config = _with_port(config, args.port)
    if args.upstream is not None:
        config = _with_upstream(config, args.upstream)
    if args.auth_mode is not None:
        config = _with_auth_mode(config, args.auth_mode)

    uvicorn.run(
        "volundr.bifrost.app:create_bifrost_app",
        factory=True,
        host=config.server.host,
        port=config.server.port,
        log_level=args.log_level,
    )


# Pydantic models are immutable-ish, so we rebuild with overrides.


def _with_host(cfg: BifrostConfig, host: str) -> BifrostConfig:
    return cfg.model_copy(update={"server": cfg.server.model_copy(update={"host": host})})


def _with_port(cfg: BifrostConfig, port: int) -> BifrostConfig:
    return cfg.model_copy(update={"server": cfg.server.model_copy(update={"port": port})})


def _with_upstream(cfg: BifrostConfig, url: str) -> BifrostConfig:
    return cfg.model_copy(update={"upstream": cfg.upstream.model_copy(update={"url": url})})


def _with_auth_mode(cfg: BifrostConfig, mode: str) -> BifrostConfig:
    new_auth = cfg.upstream.auth.model_copy(update={"mode": mode})
    new_upstream = cfg.upstream.model_copy(update={"auth": new_auth})
    return cfg.model_copy(update={"upstream": new_upstream})


if __name__ == "__main__":
    main()
