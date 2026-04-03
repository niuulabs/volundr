"""VolundrPlugin — registers Volundr as a niuu CLI plugin.

Provides the ``sessions`` top-level command group, the Volundr API service,
and TUI pages for session management.
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


class _VolundrService(Service):
    """Stub Volundr service (replaced by real implementation at runtime)."""

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
    print_error("Could not connect to Volundr. Is the platform running?")
    raise typer.Exit(1)


class VolundrPlugin(ServicePlugin):
    """Plugin for the Volundr development platform service."""

    @property
    def name(self) -> str:
        return "volundr"

    @property
    def description(self) -> str:
        return "AI-native development platform — sessions, chronicles, workspaces"

    def register_service(self) -> ServiceDefinition:
        return ServiceDefinition(
            name="volundr",
            description="AI-native development platform",
            factory=_VolundrService,
            default_enabled=True,
            depends_on=["postgres"],
            default_port=8080,
        )

    def create_service(self) -> Service:
        return self.register_service().factory()

    def create_api_client(self) -> Any:
        return _get_client()

    def register_commands(self, app: typer.Typer) -> None:
        """Mount workflow commands directly on the main app."""
        sessions = typer.Typer(
            name="sessions",
            help="Manage coding sessions.",
            no_args_is_help=True,
        )

        @sessions.command("list")
        def list_sessions(
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """List active sessions."""
            client = _get_client()
            try:
                resp = client.get("/api/v1/volundr/sessions")
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
                typer.echo("No active sessions.")
                return

            print_table(
                columns=[
                    ("id", "ID"),
                    ("name", "Name"),
                    ("status", "Status"),
                    ("model", "Model"),
                    ("tokens", "Tokens"),
                    ("created_at", "Created"),
                ],
                rows=data,
            )

        @sessions.command()
        def create(
            name: str = typer.Argument(help="Session name"),
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """Create a new session."""
            client = _get_client()
            try:
                resp = client.post(
                    "/api/v1/volundr/sessions",
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

            print_success(f"Session created: {data.get('id', 'unknown')}")

        @sessions.command()
        def stop(
            session_id: str = typer.Argument(help="Session ID"),
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """Stop a running session."""
            client = _get_client()
            try:
                resp = client.post(f"/api/v1/volundr/sessions/{session_id}/stop")
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                _handle_api_error(exc)
            except httpx.ConnectError:
                _handle_connection_error()

            if json_output:
                print_json(resp.json() if resp.text else {"status": "stopped"})
                return

            print_success(f"Session {session_id} stopped.")

        @sessions.command()
        def delete(
            session_id: str = typer.Argument(help="Session ID"),
            json_output: bool = typer.Option(False, "--json", help="Output raw JSON."),
        ) -> None:
            """Delete a session."""
            client = _get_client()
            try:
                resp = client.delete(f"/api/v1/volundr/sessions/{session_id}")
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                _handle_api_error(exc)
            except httpx.ConnectError:
                _handle_connection_error()

            if json_output:
                print_json(resp.json() if resp.text else {"status": "deleted"})
                return

            print_success(f"Session {session_id} deleted.")

        app.add_typer(sessions, name="sessions")
