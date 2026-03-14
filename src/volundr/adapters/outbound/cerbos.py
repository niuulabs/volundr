"""Cerbos authorization adapter.

Delegates authorization decisions to a Cerbos PDP over HTTP.
Accepts **kwargs (dynamic adapter pattern).
"""

from __future__ import annotations

import logging

import httpx

from volundr.domain.models import Principal
from volundr.domain.ports import AuthorizationPort, Resource

logger = logging.getLogger(__name__)


class CerbosAuthorizationAdapter(AuthorizationPort):
    """Authorization adapter that queries a Cerbos PDP.

    Cerbos is a scalable, open-source authorization layer that uses
    YAML/JSON policies evaluated via a simple HTTP API.

    Constructor kwargs (from dynamic adapter config):
        url: Base URL of the Cerbos PDP (e.g. "http://localhost:3592").
        timeout: HTTP timeout in seconds (default 5).
    """

    def __init__(
        self,
        *,
        url: str = "http://localhost:3592",
        timeout: int = 5,
        **_extra: object,
    ) -> None:
        self._url = url.rstrip("/")
        self._timeout = timeout
        self._client = httpx.AsyncClient(
            base_url=self._url,
            timeout=timeout,
        )

    async def is_allowed(
        self,
        principal: Principal,
        action: str,
        resource: Resource,
    ) -> bool:
        payload = self._build_check_payload(principal, action, [resource])

        try:
            resp = await self._client.post("/api/check/resources", json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("Cerbos request failed: %s", exc)
            return False

        return self._parse_single_result(resp.json(), resource, action)

    async def filter_allowed(
        self,
        principal: Principal,
        action: str,
        resources: list[Resource],
    ) -> list[Resource]:
        if not resources:
            return []

        payload = self._build_check_payload(principal, action, resources)

        try:
            resp = await self._client.post("/api/check/resources", json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            logger.error("Cerbos batch request failed: %s", exc)
            return []

        return self._parse_batch_results(resp.json(), resources, action)

    def _build_check_payload(
        self,
        principal: Principal,
        action: str,
        resources: list[Resource],
    ) -> dict:
        return {
            "principal": {
                "id": principal.user_id,
                "roles": list(principal.roles),
                "attr": {
                    "email": principal.email,
                    "tenant_id": principal.tenant_id,
                },
            },
            "resources": [
                {
                    "actions": [action],
                    "resource": {
                        "kind": resource.kind,
                        "id": resource.id,
                        "attr": resource.attr,
                    },
                }
                for resource in resources
            ],
        }

    def _parse_single_result(self, data: dict, resource: Resource, action: str) -> bool:
        for result in data.get("results", []):
            res = result.get("resource", {})
            if res.get("id") == resource.id and res.get("kind") == resource.kind:
                effect = result.get("actions", {}).get(action, {}).get("effect", "EFFECT_DENY")
                return effect == "EFFECT_ALLOW"
        return False

    def _parse_batch_results(
        self,
        data: dict,
        resources: list[Resource],
        action: str,
    ) -> list[Resource]:
        allowed_ids: set[str] = set()
        for result in data.get("results", []):
            res = result.get("resource", {})
            effect = result.get("actions", {}).get(action, {}).get("effect", "EFFECT_DENY")
            if effect == "EFFECT_ALLOW":
                allowed_ids.add(res.get("id", ""))

        return [r for r in resources if r.id in allowed_ids]

    async def close(self) -> None:
        await self._client.aclose()
