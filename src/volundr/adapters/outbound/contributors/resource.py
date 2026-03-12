"""Resource contributor — translates user-friendly resource config to K8s primitives."""

import logging
from typing import Any

from volundr.domain.models import Session
from volundr.domain.ports import (
    ResourceProvider,
    SessionContext,
    SessionContribution,
    SessionContributor,
)

logger = logging.getLogger(__name__)


class ResourceContributor(SessionContributor):
    """Translates ad-hoc resource config into K8s-native Helm values.

    Reads ``resource_config`` from the SessionContext (user launch request)
    and calls ResourceProvider.translate() to produce K8s-native values.
    Template/profile resource configs are already K8s-native and pass through
    directly via TemplateContributor.
    """

    def __init__(
        self,
        *,
        resource_provider: ResourceProvider | None = None,
        **_extra: object,
    ) -> None:
        self._resource_provider = resource_provider

    @property
    def name(self) -> str:
        return "resource"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        if self._resource_provider is None:
            return SessionContribution()

        # Ad-hoc resource config from the launch request takes priority
        resource_config = context.resource_config
        if not resource_config:
            return SessionContribution()

        # Validate
        errors = self._resource_provider.validate(resource_config)
        if errors:
            logger.warning(
                "Resource validation warnings for session %s: %s",
                session.id,
                "; ".join(errors),
            )

        # Translate to K8s primitives
        translated = self._resource_provider.translate(resource_config)

        values: dict[str, Any] = {}

        if translated.requests or translated.limits:
            values["resources"] = {}
            if translated.requests:
                values["resources"]["requests"] = translated.requests
            if translated.limits:
                values["resources"]["limits"] = translated.limits

        if translated.node_selector:
            values["nodeSelector"] = translated.node_selector

        if translated.tolerations:
            values["tolerations"] = translated.tolerations

        if translated.runtime_class_name:
            values["runtimeClassName"] = translated.runtime_class_name

        if values:
            logger.info(
                "Resource contributor: session %s → %s",
                session.id,
                {k: v for k, v in values.items() if k != "resources"},
            )

        return SessionContribution(values=values)
