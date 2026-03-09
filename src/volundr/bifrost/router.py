"""Model router — maps rule labels to routing decisions."""

from __future__ import annotations

import logging

from volundr.bifrost.models import ParsedRequest, RouteDecision

logger = logging.getLogger(__name__)


class RouteConfig:
    """Routing configuration for a single label."""

    def __init__(
        self,
        upstream: str = "default",
        model: str | None = None,
        enrich: bool = True,
        tool_capable: bool = True,
    ) -> None:
        self.upstream = upstream
        self.model = model
        self.enrich = enrich
        self.tool_capable = tool_capable


class ModelRouter:
    """Maps rule labels to routing decisions.

    If a label is unknown, falls back to ``default``.
    If a route is not tool-capable but the request has tools,
    falls back to ``default``.
    """

    def __init__(self, routing: dict[str, RouteConfig]) -> None:
        self._routing = routing

    def route(
        self,
        label: str,
        request: ParsedRequest,
    ) -> RouteDecision:
        config = self._routing.get(label)
        used_label = label

        if config is None:
            config = self._routing.get("default")
            used_label = "default"

        # Tool capability guard
        if config and request.has_tools and not config.tool_capable:
            logger.debug(
                "Route %s not tool-capable, falling back to default",
                used_label,
            )
            config = self._routing.get("default")
            used_label = "default"

        if config is None:
            return RouteDecision(
                upstream_name="default",
                model=None,
                enrich=True,
                label=used_label,
            )

        return RouteDecision(
            upstream_name=config.upstream,
            model=config.model,
            enrich=config.enrich,
            label=used_label,
        )
