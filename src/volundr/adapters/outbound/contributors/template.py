"""Template contributor — wraps TemplateProvider and ProfileProvider."""

import logging
from typing import Any

from volundr.domain.models import ForgeProfile, Session, WorkspaceTemplate
from volundr.domain.ports import (
    ProfileProvider,
    SessionContext,
    SessionContribution,
    SessionContributor,
    TemplateProvider,
)

logger = logging.getLogger(__name__)


class TemplateContributor(SessionContributor):
    """Merges workspace template or forge profile runtime config into Helm values."""

    def __init__(
        self,
        *,
        template_provider: TemplateProvider | None = None,
        profile_provider: ProfileProvider | None = None,
        **_extra: object,
    ):
        self._template_provider = template_provider
        self._profile_provider = profile_provider

    @property
    def name(self) -> str:
        return "template"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        values: dict[str, Any] = {}

        # Resolve template first, fall back to profile
        template = self._resolve_template(context.template_name)
        profile = self._resolve_profile(context.profile_name) if template is None else None

        source = template or profile
        if source is None:
            return SessionContribution(values=values)

        self._apply(values, source)

        return SessionContribution(values=values)

    def _resolve_template(self, name: str | None) -> WorkspaceTemplate | None:
        if not name or self._template_provider is None:
            return None
        template = self._template_provider.get(name)
        if template is not None:
            logger.info("Using workspace template: %s", name)
        return template

    def _resolve_profile(self, name: str | None) -> ForgeProfile | None:
        if self._profile_provider is None:
            return None
        if name:
            profile = self._profile_provider.get(name)
            if profile is not None:
                logger.info("Using forge profile: %s", name)
                return profile
            logger.warning("Forge profile not found: %s, trying default", name)
        default = self._profile_provider.get_default("session")
        if default is not None:
            logger.info("Using default forge profile: %s", default.name)
        return default

    @staticmethod
    def _apply(values: dict, source: WorkspaceTemplate | ForgeProfile) -> None:
        """Merge runtime config from template or profile into values.

        Template/profile resource configs are already in K8s-native format
        (e.g. ``{"requests": {"cpu": "100m"}}``), so they pass through directly
        as ``resources``.  Ad-hoc user configs from the launch request are
        translated by ``ResourceContributor`` via the ``SessionContext``.
        """
        if source.resource_config:
            values["resources"] = source.resource_config
        if source.env_vars:
            values["env"] = source.env_vars
        if source.env_secret_refs:
            values["envSecretRefs"] = source.env_secret_refs
        if source.mcp_servers:
            values["mcpServers"] = source.mcp_servers
        if source.system_prompt:
            values.setdefault("session", {})["systemPrompt"] = source.system_prompt
        if source.workload_config:
            for key, value in source.workload_config.items():
                values.setdefault(key, value)
