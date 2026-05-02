"""Smoke-test script for canonical vs legacy route parity.

Runs a focused set of HTTP calls against both legacy and canonical route
surfaces and reports whether responses are equivalent.

Usage:
    python -m tests/smoke_tests_route_parity --base-url http://localhost:8080 --token $TOKEN

If no --base-url is given, the script reads from environment or defaults to
http://localhost:8080.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import urllib.parse
from dataclasses import dataclass, field
from typing import Any

import httpx

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Route pair definitions
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RoutePair:
    """A legacy → canonical route pair for comparison."""

    name: str
    legacy: RouteSpec
    canonical: RouteSpec


@dataclass(frozen=True)
class RouteSpec:
    path: str
    method: str = "GET"
    params: dict[str, Any] = field(default_factory=dict)
    json_body: Any = None
    headers: dict[str, str] = field(default_factory=dict)


# Define representative route pairs per domain.
# Only includes the highest-risk domains mentioned in the RAID scope.
ROUTE_PAIRS: list[RoutePair] = [
    # ── Identity ──────────────────────────────────────────────────────────
    RoutePair(
        "identity/me",
        RouteSpec("/api/v1/volundr/me", method="GET"),
        RouteSpec("/api/v1/identity/me", method="GET"),
    ),
    RoutePair(
        "identity/tenants",
        RouteSpec("/api/v1/volundr/identity", method="GET"),
        RouteSpec("/api/v1/identity/tenants", method="GET"),
    ),
    # ── Tracker ───────────────────────────────────────────────────────────
    RoutePair(
        "tracker/status",
        RouteSpec("/api/v1/tracker/status", method="GET"),
        RouteSpec("/api/v1/tracker/status", method="GET"),
    ),
    RoutePair(
        "tracker/issues",
        RouteSpec("/api/v1/tracker/issues", method="GET", params={"limit": 10}),
        RouteSpec("/api/v1/tracker/issues", method="GET", params={"limit": 10}),
    ),
    # ── Integrations ──────────────────────────────────────────────────────
    RoutePair(
        "integrations/list",
        RouteSpec("/api/v1/volundr/integrations", method="GET"),
        RouteSpec("/api/v1/integrations", method="GET"),
    ),
    # ── Audit ─────────────────────────────────────────────────────────────
    RoutePair(
        "audit/events",
        RouteSpec("/api/v1/volundr/audit/events", method="GET", params={"limit": 10}),
        RouteSpec("/api/v1/audit/events", method="GET", params={"limit": 10}),
    ),
    # ── Forge: Sessions ───────────────────────────────────────────────────
    RoutePair(
        "forge/sessions/list",
        RouteSpec("/api/v1/volundr/sessions", method="GET"),
        RouteSpec("/api/v1/forge/sessions", method="GET"),
    ),
    # ── Forge: Templates ──────────────────────────────────────────────────
    RoutePair(
        "forge/templates",
        RouteSpec("/api/v1/volundr/templates", method="GET"),
        RouteSpec("/api/v1/forge/templates", method="GET"),
    ),
    # ── Forge: Workspaces ─────────────────────────────────────────────────
    RoutePair(
        "forge/workspaces",
        RouteSpec("/api/v1/volundr/workspaces", method="GET"),
        RouteSpec("/api/v1/forge/workspaces", method="GET"),
    ),
    # ── Tokens ────────────────────────────────────────────────────────────
    RoutePair(
        "tokens/list",
        RouteSpec("/api/v1/volundr/tokens", method="GET"),
        RouteSpec("/api/v1/tokens", method="GET"),
    ),
    # ── Credentials ───────────────────────────────────────────────────────
    RoutePair(
        "credentials/user",
        RouteSpec("/api/v1/volundr/credentials", method="GET"),
        RouteSpec("/api/v1/credentials/user", method="GET"),
    ),
    # ── Features ──────────────────────────────────────────────────────────
    RoutePair(
        "features/modules",
        RouteSpec("/api/v1/volundr/features", method="GET"),
        RouteSpec("/api/v1/features", method="GET"),
    ),
]


# Fields to ignore when comparing JSON payloads (internal-only fields)
IGNORED_FIELDS = frozenset(
    {
        "chat_endpoint",
        "code_endpoint",
        "pod_name",
        "error",
        "archived_at",
    }
)


def _strip_internal(payload: Any) -> Any:
    """Remove internal-only fields from a JSON payload for comparison."""
    if isinstance(payload, dict):
        return {k: _strip_internal(v) for k, v in payload.items() if k not in IGNORED_FIELDS}
    if isinstance(payload, list):
        return [_strip_internal(item) for item in payload]
    return payload


def _same_shape(resp_a: httpx.Response, resp_b: httpx.Response) -> tuple[bool, str]:
    """Compare two responses — check status code then JSON shape."""
    if resp_a.status_code != resp_b.status_code:
        return False, (
            f"status mismatch: {resp_a.status_code} vs {resp_b.status_code}"
        )

    # Allow 204 No Content without body
    if resp_a.status_code == 204 and resp_b.status_code == 204:
        return True, "OK (204)"

    try:
        payload_a = resp_a.json()
    except Exception:
        payload_a = None

    try:
        payload_b = resp_b.json()
    except Exception:
        payload_b = None

    if payload_a is None and payload_b is None:
        return True, "OK (no body)"

    if payload_a is None or payload_b is None:
        return False, "body mismatch (one is None)"

    normalized_a = _strip_internal(payload_a)
    normalized_b = _strip_internal(payload_b)

    if normalized_a == normalized_b:
        return True, "OK"

    # Fuzzy diff: show top-level keys that differ
    set_a = set(normalized_a.keys()) if isinstance(normalized_a, dict) else set()
    set_b = set(normalized_b.keys()) if isinstance(normalized_b, dict) else set()
    if set_a != set_b:
        return False, f"keys differ: {set_a.symmetric_difference(set_b)}"

    return False, "payload differs (see --verbose for details)"


def run_smoke_test(
    base_url: str,
    token: str | None = None,
    timeout: float = 10.0,
) -> list[tuple[RoutePair, bool, str]]:
    """Run all smoke tests and return results."""
    results: list[tuple[RoutePair, bool, str]] = []
    headers: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    with httpx.Client(base_url=base_url, timeout=timeout, headers=headers) as client:
        for pair in ROUTE_PAIRS:
            log.info("Testing %s …", pair.name)
            try:
                legacy_resp = client.request(
                    pair.legacy.method,
                    pair.legacy.path,
                    params=pair.legacy.params,
                    json=pair.legacy.json_body,
                )
                canonical_resp = client.request(
                    pair.canonical.method,
                    pair.canonical.path,
                    params=pair.canonical.params,
                    json=pair.canonical.json_body,
                )
            except httpx.RequestError as exc:
                results.append((pair, False, f"request error: {exc}"))
                continue

            ok, detail = _same_shape(legacy_resp, canonical_resp)
            results.append((pair, ok, detail))
            status = "PASS" if ok else "FAIL"
            log.info("  %s: %s — %s", status, pair.name, detail)

    return results


def print_report(results: list[tuple[RoutePair, bool, str]]) -> int:
    """Print a summary report. Returns 1 if any test failed."""
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    failed = total - passed

    print()
    print("=" * 60)
    print("  Smoke Test Report: Canonical Route Parity")
    print("=" * 60)
    print(f"  Total : {total}")
    print(f"  Passed: {passed}")
    print(f"  Failed: {failed}")
    print("=" * 60)

    if failed:
        print()
        print("Failures:")
        for pair, ok, detail in results:
            if not ok:
                print(f"  ✗ {pair.name}: {detail}")

    print()
    return 1 if failed else 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Smoke-test canonical vs legacy route parity.",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help="Base URL of the volundr/niuu instance (default: http://localhost:8080).",
    )
    parser.add_argument(
        "--token",
        default=None,
        help="Bearer token for authentication.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=10.0,
        help="Request timeout in seconds (default: 10).",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print full JSON diffs on failure.",
    )

    args = parser.parse_args()
    base_url = args.base_url or "http://localhost:8080"
    token = args.token or ""

    # Strip trailing slash
    base_url = base_url.rstrip("/")

    results = run_smoke_test(base_url, token or None, timeout=args.timeout)
    sys.exit(print_report(results))


if __name__ == "__main__":
    main()
