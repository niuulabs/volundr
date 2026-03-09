"""Gateway contributor — wraps GatewayPort."""

from typing import Any

from volundr.domain.models import Session
from volundr.domain.ports import (
    GatewayPort,
    SessionContext,
    SessionContribution,
    SessionContributor,
)


class GatewayContributor(SessionContributor):
    """Provides gateway configuration for HTTPRoute creation in Skuld."""

    def __init__(
        self,
        *,
        gateway: GatewayPort | None = None,
        **_extra: object,
    ):
        self._gateway = gateway

    @property
    def name(self) -> str:
        return "gateway"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        if self._gateway is None:
            return SessionContribution()

        gateway_config = self._gateway.get_gateway_config()
        if not gateway_config:
            return SessionContribution()

        gw: dict[str, Any] = {
            "enabled": True,
            "name": gateway_config.get("gateway_name", "volundr-gateway"),
            "namespace": gateway_config.get(
                "gateway_namespace",
                "volundr-system",
            ),
            "userId": session.owner_id or "",
        }
        cors_origins_str = gateway_config.get("cors_origins", "*")
        gw["cors"] = {
            "allowOrigins": cors_origins_str.split(","),
            "allowMethods": ["GET", "POST", "OPTIONS"],
            "allowHeaders": ["Authorization", "Content-Type"],
            "allowCredentials": True,
        }
        issuer = gateway_config.get("issuer_url", "")
        if issuer:
            gw["jwt"] = {
                "enabled": True,
                "issuer": issuer,
                "audiences": [gateway_config.get("audience", "volundr")],
                "jwksUri": gateway_config.get("jwks_uri", ""),
            }

        return SessionContribution(values={"gateway": gw})
