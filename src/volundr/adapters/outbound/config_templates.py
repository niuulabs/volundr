"""Configuration-driven adapter for workspace templates.

Templates are loaded from YAML config (or Kubernetes CRDs in future)
rather than stored in a database.
"""

from __future__ import annotations

from volundr.config import TemplateConfig
from volundr.domain.models import WorkspaceTemplate
from volundr.domain.ports import TemplateProvider


class ConfigTemplateProvider(TemplateProvider):
    """Reads workspace templates from application configuration."""

    def __init__(self, configs: list[TemplateConfig]):
        self._templates: dict[str, WorkspaceTemplate] = {}
        for cfg in configs:
            self._templates[cfg.name] = WorkspaceTemplate(
                name=cfg.name,
                description=cfg.description,
                repos=cfg.repos,
                setup_scripts=cfg.setup_scripts,
                workspace_layout=cfg.workspace_layout,
                is_default=cfg.is_default,
                workload_type=cfg.workload_type,
                model=cfg.model,
                system_prompt=cfg.system_prompt,
                resource_config=cfg.resource_config,
                mcp_servers=cfg.mcp_servers,
                env_vars=cfg.env_vars,
                env_secret_refs=cfg.env_secret_refs,
                workload_config=cfg.workload_config,
                session_definition=cfg.session_definition,
            )

    def get(self, name: str) -> WorkspaceTemplate | None:
        """Retrieve a template by name."""
        return self._templates.get(name)

    def list(self, workload_type: str | None = None) -> list[WorkspaceTemplate]:
        """List all templates, optionally filtered by workload type."""
        templates = list(self._templates.values())
        if workload_type is not None:
            templates = [t for t in templates if t.workload_type == workload_type]
        return sorted(templates, key=lambda t: t.name)
