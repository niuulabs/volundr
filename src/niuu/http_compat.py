"""Compatibility helpers for legacy route shims during migrations."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI, Request, Response


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class LegacyRouteNotice:
    """Metadata describing a legacy route and its canonical replacement."""

    legacy_path: str
    canonical_path: str
    sunset: str | None = None


def apply_deprecation_headers(response: Response, notice: LegacyRouteNotice) -> None:
    """Attach standardized deprecation headers to a legacy route response."""
    response.headers["Deprecation"] = "true"
    response.headers["X-Niuu-Legacy-Route"] = notice.legacy_path
    response.headers["X-Niuu-Canonical-Route"] = notice.canonical_path
    response.headers["Link"] = f'<{notice.canonical_path}>; rel="successor-version"'
    if notice.sunset:
        response.headers["Sunset"] = notice.sunset


def record_legacy_route_use(
    app: FastAPI,
    notice: LegacyRouteNotice,
    *,
    method: str,
) -> int:
    """Count a legacy route hit on app.state for migration tracking."""
    hits = getattr(app.state, "legacy_route_hits", {})
    key = (notice.legacy_path, notice.canonical_path, method.upper())
    current = int(hits.get(key, 0)) + 1
    hits[key] = current
    app.state.legacy_route_hits = hits
    return current


def warn_on_legacy_route(
    request: Request,
    response: Response,
    notice: LegacyRouteNotice,
    *,
    route_logger: logging.Logger | None = None,
) -> int:
    """Apply headers, track usage, and emit a structured warning log."""
    apply_deprecation_headers(response, notice)
    count = record_legacy_route_use(request.app, notice, method=request.method)

    active_logger = route_logger or logger
    active_logger.warning(
        "Legacy route hit method=%s legacy=%s canonical=%s count=%d",
        request.method.upper(),
        notice.legacy_path,
        notice.canonical_path,
        count,
    )
    return count
