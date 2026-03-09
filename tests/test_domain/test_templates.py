"""Tests for WorkspaceTemplateService."""

from __future__ import annotations

import pytest

from volundr.domain.models import WorkspaceTemplate
from volundr.domain.ports import TemplateProvider
from volundr.domain.services.template import WorkspaceTemplateService


class InMemoryTemplateProvider(TemplateProvider):
    """In-memory template provider for testing."""

    def __init__(self, templates: list[WorkspaceTemplate] | None = None):
        self._templates: dict[str, WorkspaceTemplate] = {}
        for t in templates or []:
            self._templates[t.name] = t

    def get(self, name: str) -> WorkspaceTemplate | None:
        return self._templates.get(name)

    def list(self, workload_type: str | None = None) -> list[WorkspaceTemplate]:
        templates = list(self._templates.values())
        if workload_type is not None:
            templates = [t for t in templates if t.workload_type == workload_type]
        return sorted(templates, key=lambda t: t.name)


@pytest.fixture
def sample_templates() -> list[WorkspaceTemplate]:
    """Create sample templates."""
    return [
        WorkspaceTemplate(
            name="default-session",
            description="Default coding session",
            workload_type="session",
            model="claude-sonnet-4",
            resource_config={"cpu": "500m", "memory": "1Gi"},
            repos=[{"url": "https://github.com/org/repo", "branch": "main"}],
            setup_scripts=["pip install -r requirements.txt"],
            workspace_layout={"editor": "vscode"},
            is_default=True,
        ),
        WorkspaceTemplate(
            name="data-science",
            description="Data science workspace",
            workload_type="session",
            model="claude-opus-4",
            resource_config={"cpu": "2", "memory": "8Gi"},
        ),
    ]


@pytest.fixture
def template_provider(sample_templates) -> InMemoryTemplateProvider:
    """Create a template provider with sample data."""
    return InMemoryTemplateProvider(sample_templates)


@pytest.fixture
def template_service(template_provider) -> WorkspaceTemplateService:
    """Create a template service with test doubles."""
    return WorkspaceTemplateService(provider=template_provider)


class TestGetTemplate:
    """Tests for WorkspaceTemplateService.get_template."""

    def test_get_template(self, template_service: WorkspaceTemplateService):
        """Getting an existing template returns it."""
        result = template_service.get_template("default-session")

        assert result is not None
        assert result.name == "default-session"
        assert result.description == "Default coding session"
        assert result.workload_type == "session"
        assert result.model == "claude-sonnet-4"

    def test_get_template_not_found(self, template_service: WorkspaceTemplateService):
        """Getting a nonexistent template returns None."""
        result = template_service.get_template("nonexistent")
        assert result is None


class TestListTemplates:
    """Tests for WorkspaceTemplateService.list_templates."""

    def test_list_templates(self, template_service: WorkspaceTemplateService):
        """Listing templates returns all templates."""
        result = template_service.list_templates()

        assert len(result) == 2
        names = {t.name for t in result}
        assert names == {"default-session", "data-science"}

    def test_list_templates_empty(self):
        """Listing templates when none exist returns empty list."""
        service = WorkspaceTemplateService(provider=InMemoryTemplateProvider())
        result = service.list_templates()
        assert result == []

    def test_list_templates_filtered_by_workload_type(
        self, template_service: WorkspaceTemplateService
    ):
        """Listing templates filtered by workload_type returns matching."""
        result = template_service.list_templates(workload_type="session")

        assert len(result) == 2

    def test_list_templates_filter_no_match(self, template_service: WorkspaceTemplateService):
        """Listing templates with non-matching filter returns empty."""
        result = template_service.list_templates(workload_type="nonexistent")
        assert result == []
