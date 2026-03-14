"""Service for reading workspace templates from configuration."""

from __future__ import annotations

from volundr.domain.models import WorkspaceTemplate
from volundr.domain.ports import TemplateProvider


class WorkspaceTemplateService:
    """Read-only service for workspace templates.

    Templates are loaded from configuration (YAML, CRDs) — not from
    a database. This service provides a clean domain interface over
    the underlying TemplateProvider.
    """

    def __init__(self, provider: TemplateProvider):
        self._provider = provider

    def get_template(self, name: str) -> WorkspaceTemplate | None:
        """Get a template by name."""
        return self._provider.get(name)

    def list_templates(self, workload_type: str | None = None) -> list[WorkspaceTemplate]:
        """List all templates, optionally filtered by workload type."""
        return self._provider.list(workload_type=workload_type)
