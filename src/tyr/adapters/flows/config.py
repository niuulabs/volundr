"""ConfigFlockFlowProvider — YAML file + in-memory runtime additions.

Mirrors the pattern used by ConfigProfileProvider in Volundr (NIU-639):
load a YAML list of flows at startup, keep a mutable in-memory dict, and
let the REST API add/remove flows at runtime without touching the file.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from tyr.domain.flock_flow import FlockFlowConfig, FlockPersonaOverride, PersonaLLMOverride
from tyr.ports.flock_flow import FlockFlowProvider

logger = logging.getLogger(__name__)


def _parse_llm(raw: Any) -> PersonaLLMOverride | None:
    """Parse the ``llm:`` sub-dict of a persona entry; returns None when absent/invalid."""
    if not isinstance(raw, dict):
        return None
    return PersonaLLMOverride(
        primary_alias=str(raw.get("primary_alias", "")),
        thinking_enabled=bool(raw.get("thinking_enabled", False)),
        max_tokens=int(raw.get("max_tokens", 0)),
    )


def _parse_persona(raw: Any) -> FlockPersonaOverride | None:
    """Parse one persona entry from a raw YAML value."""
    if isinstance(raw, str):
        return FlockPersonaOverride(name=raw)
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name", "")).strip()
    if not name:
        return None
    return FlockPersonaOverride(
        name=name,
        llm=_parse_llm(raw.get("llm")),
        system_prompt_extra=str(raw.get("system_prompt_extra", "")),
        iteration_budget=int(raw.get("iteration_budget", 0)),
        max_concurrent_tasks=int(raw.get("max_concurrent_tasks", 0)),
    )


def parse_flow(raw: Any) -> FlockFlowConfig | None:
    """Parse one flow entry from a raw YAML dict.

    Returns ``None`` when the entry is malformed or missing a ``name``.
    Exported so test_configmap_provider can reuse the same parsing logic.
    """
    if not isinstance(raw, dict):
        return None
    name = str(raw.get("name", "")).strip()
    if not name:
        return None

    personas: list[FlockPersonaOverride] = []
    for p in raw.get("personas", []):
        persona = _parse_persona(p)
        if persona is not None:
            personas.append(persona)

    return FlockFlowConfig(
        name=name,
        description=str(raw.get("description", "")),
        personas=personas,
        mesh_transport=str(raw.get("mesh_transport", "nng")),
        mimir_hosted_url=str(raw.get("mimir_hosted_url", "")),
        sleipnir_publish_urls=list(raw.get("sleipnir_publish_urls", [])),
        max_concurrent_tasks=int(raw.get("max_concurrent_tasks", 3)),
    )


class ConfigFlockFlowProvider(FlockFlowProvider):
    """Loads flock flows from a YAML file at startup.

    Runtime ``save`` / ``delete`` calls mutate an in-memory dict; the backing
    file is **not** rewritten (mirrors ConfigProfileProvider semantics).

    Example ``flock_flows.yaml``::

        - name: code-review-flow
          description: Standard code-review flock
          personas:
            - name: coordinator
            - name: reviewer
              llm:
                primary_alias: powerful
                thinking_enabled: true
          mimir_hosted_url: https://mimir.example.com
    """

    def __init__(self, path: str = "") -> None:
        self._path: Path | None = Path(path) if path else None
        self._flows: dict[str, FlockFlowConfig] = {}
        self._load()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _load(self) -> None:
        if self._path is None or not self._path.is_file():
            return
        try:
            text = self._path.read_text(encoding="utf-8")
            raw = yaml.safe_load(text)
            if not isinstance(raw, list):
                logger.warning(
                    "ConfigFlockFlowProvider: %s must be a YAML list, got %s",
                    self._path,
                    type(raw).__name__,
                )
                return
            for item in raw:
                flow = parse_flow(item)
                if flow is not None:
                    self._flows[flow.name] = flow
            logger.info(
                "ConfigFlockFlowProvider: loaded %d flow(s) from %s",
                len(self._flows),
                self._path,
            )
        except Exception:
            logger.warning(
                "ConfigFlockFlowProvider: failed to load %s",
                self._path,
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # FlockFlowProvider
    # ------------------------------------------------------------------

    def get(self, name: str) -> FlockFlowConfig | None:
        return self._flows.get(name)

    def list(self) -> list[FlockFlowConfig]:
        return list(self._flows.values())

    def save(self, flow: FlockFlowConfig) -> None:
        self._flows[flow.name] = flow

    def delete(self, name: str) -> bool:
        if name not in self._flows:
            return False
        del self._flows[name]
        return True
