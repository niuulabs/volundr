"""TyrPlugin — registers Tyr as a niuu CLI plugin.

Provides ``sagas`` and ``raids`` top-level command groups, the Tyr
coordinator service, and TUI pages for saga management.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import typer

from niuu.cli_api_client import CLIAPIClient
from niuu.cli_output import (
    format_api_error,
    print_error,
    print_json,
    print_success,
    print_table,
)
from niuu.ports.plugin import Service, ServiceDefinition, ServicePlugin


class _TyrService(Service):
    """Stub Tyr service (replaced by real implementation at runtime)."""

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass

    async def health_check(self) -> bool:
        return True


def _get_client() -> CLIAPIClient:
    """Build a CLIAPIClient from the active context.

    Falls back to localhost:8080 when no context is configured.
    """
    return CLIAPIClient(base_url="http://localhost:8080")


def _handle_api_error(exc: httpx.HTTPStatusError) -> None:
    """Extract detail from an API error response and print it."""
    try:
        detail = exc.response.json().get("detail", exc.response.text)
    except (json.JSONDecodeError, ValueError):
        detail = exc.response.text
    print_error(format_api_error(exc.response.status_code, str(detail)))
    raise typer.Exit(1)


def _handle_connection_error() -> None:
    print_error("Could not connect to Tyr. Is the platform running?")
    raise typer.Exit(1)


class TyrPlugin(ServicePlugin):
    """Plugin for the Tyr saga coordinator service."""

    @property
    def name(self) -> str:
        return "tyr"

    @property
    def description(self) -> str:
        return "Autonomous saga coordinator — reviews, dispatch, raids"

    def register_service(self) -> ServiceDefinition:
        return ServiceDefinition(
            name="tyr",
            description="Autonomous saga coordinator",
            factory=_TyrService,
            default_enabled=True,
            depends_on=["postgres", "volundr"],
            default_port=8081,
        )

    def create_service(self) -> Service:
        return self.register_service().factory()

    def create_api_client(self) -> Any:
        return _get_client()

    def register_commands(self, app: typer.Typer) -> None:
        """Mount workflow commands directly on the main app."""

        # ── Sagas ──────────────────────────────────────────────────── #

        sagas = typer.Typer(
            name="sagas",
            help="Manage sagas.",
            no_args_is_help=True,
        )

        @sagas.command("list")
        def list_sagas(
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """List active sagas."""
            client = _get_client()
            try:
                resp = client.get("/api/v1/tyr/sagas")
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                _handle_api_error(exc)
            except httpx.ConnectError:
                _handle_connection_error()

            data = resp.json()

            if json_output:
                print_json(data)
                return

            if not data:
                typer.echo("No active sagas.")
                return

            print_table(
                columns=[
                    ("id", "ID"),
                    ("name", "Name"),
                    ("status", "Status"),
                    ("progress", "Progress"),
                    ("raid_count", "Raids"),
                ],
                rows=data,
            )

        @sagas.command()
        def create(
            name: str = typer.Argument(help="Saga name"),
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """Create a new saga."""
            client = _get_client()
            try:
                resp = client.post(
                    "/api/v1/tyr/sagas/commit",
                    json_body={"name": name},
                )
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                _handle_api_error(exc)
            except httpx.ConnectError:
                _handle_connection_error()

            data = resp.json()

            if json_output:
                print_json(data)
                return

            print_success(f"Saga created: {data.get('id', 'unknown')}")

        @sagas.command()
        def dispatch(
            saga_id: str = typer.Argument(help="Saga ID"),
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """Dispatch a saga for execution."""
            client = _get_client()
            try:
                resp = client.post(
                    "/api/v1/tyr/dispatch/approve",
                    json_body={"saga_id": saga_id},
                )
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                _handle_api_error(exc)
            except httpx.ConnectError:
                _handle_connection_error()

            data = resp.json()

            if json_output:
                print_json(data)
                return

            print_success(f"Saga {saga_id} dispatched.")

        # ── Raids ──────────────────────────────────────────────────── #

        raids = typer.Typer(
            name="raids",
            help="Manage raids.",
            no_args_is_help=True,
        )

        @raids.command()
        def active(
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """List active raids."""
            client = _get_client()
            try:
                resp = client.get("/api/v1/tyr/raids/active")
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                _handle_api_error(exc)
            except httpx.ConnectError:
                _handle_connection_error()

            data = resp.json()

            if json_output:
                print_json(data)
                return

            if not data:
                typer.echo("No active raids.")
                return

            print_table(
                columns=[
                    ("id", "ID"),
                    ("name", "Name"),
                    ("status", "Status"),
                    ("confidence", "Confidence"),
                    ("session", "Session"),
                ],
                rows=data,
            )

        @raids.command()
        def approve(
            raid_id: str = typer.Argument(help="Raid ID"),
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """Approve a pending raid."""
            client = _get_client()
            try:
                resp = client.post(f"/api/v1/tyr/raids/{raid_id}/approve")
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                _handle_api_error(exc)
            except httpx.ConnectError:
                _handle_connection_error()

            if json_output:
                print_json(resp.json() if resp.text else {"status": "approved"})
                return

            print_success(f"Raid {raid_id} approved.")

        @raids.command()
        def reject(
            raid_id: str = typer.Argument(help="Raid ID"),
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """Reject a pending raid."""
            client = _get_client()
            try:
                resp = client.post(f"/api/v1/tyr/raids/{raid_id}/reject")
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                _handle_api_error(exc)
            except httpx.ConnectError:
                _handle_connection_error()

            if json_output:
                print_json(resp.json() if resp.text else {"status": "rejected"})
                return

            print_success(f"Raid {raid_id} rejected.")

        @raids.command()
        def retry(
            raid_id: str = typer.Argument(help="Raid ID"),
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """Retry a failed raid."""
            client = _get_client()
            try:
                resp = client.post(f"/api/v1/tyr/raids/{raid_id}/retry")
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                _handle_api_error(exc)
            except httpx.ConnectError:
                _handle_connection_error()

            if json_output:
                print_json(resp.json() if resp.text else {"status": "retrying"})
                return

            print_success(f"Raid {raid_id} retry initiated.")

        app.add_typer(sagas, name="sagas")
        app.add_typer(raids, name="raids")
