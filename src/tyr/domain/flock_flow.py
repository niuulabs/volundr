"""Domain models for FlockFlowConfig — reusable named flock compositions.

A FlockFlowConfig captures a named, versioned set of persona overrides that can
be referenced from dispatch requests and REST-managed via the FlockFlowProvider
port. At dispatch time, a referenced flow is *snapshotted* into the
``workload_config.personas`` list-of-dicts so that mutations to the flow after
dispatch cannot affect in-flight pod configuration (NIU-643 §6.2 Q3).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PersonaLLMOverride:
    """Per-persona LLM override fields forwarded into ``workload_config.personas[n].llm``."""

    primary_alias: str = ""
    thinking_enabled: bool = False
    max_tokens: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Serialize to the wire dict format; omits zero-value fields."""
        d: dict[str, Any] = {}
        if self.primary_alias:
            d["primary_alias"] = self.primary_alias
        if self.thinking_enabled:
            d["thinking_enabled"] = self.thinking_enabled
        if self.max_tokens:
            d["max_tokens"] = self.max_tokens
        return d


@dataclass
class FlockPersonaOverride:
    """One persona slot in a FlockFlowConfig with optional per-persona overrides."""

    name: str
    llm: PersonaLLMOverride | None = None
    system_prompt_extra: str = ""
    iteration_budget: int = 0
    max_concurrent_tasks: int = 0

    def to_dict(self) -> dict[str, Any]:
        """Serialize to the wire dict format expected by ``workload_config.personas``."""
        d: dict[str, Any] = {"name": self.name}
        if self.llm is not None:
            llm_dict = self.llm.to_dict()
            if llm_dict:
                d["llm"] = llm_dict
        if self.system_prompt_extra:
            d["system_prompt_extra"] = self.system_prompt_extra
        if self.iteration_budget:
            d["iteration_budget"] = self.iteration_budget
        if self.max_concurrent_tasks:
            d["max_concurrent_tasks"] = self.max_concurrent_tasks
        return d


@dataclass
class FlockFlowConfig:
    """A named, reusable flock composition that can be dispatched by name."""

    name: str
    description: str = ""
    personas: list[FlockPersonaOverride] = field(default_factory=list)
    mesh_transport: str = "nng"
    mimir_hosted_url: str = ""
    sleipnir_publish_urls: list[str] = field(default_factory=list)
    max_concurrent_tasks: int = 3

    def snapshot_personas(self) -> list[dict[str, Any]]:
        """Return a deep-copied list-of-dicts snapshot for inline workload_config embedding.

        Callers embed the snapshot directly into the SpawnRequest so that
        subsequent mutations to this flow object cannot affect the in-flight request.
        """
        return [p.to_dict() for p in self.personas]

    def to_dict(self) -> dict[str, Any]:
        """Full serialization for persistence (YAML / ConfigMap round-trip)."""
        return {
            "name": self.name,
            "description": self.description,
            "personas": [p.to_dict() for p in self.personas],
            "mesh_transport": self.mesh_transport,
            "mimir_hosted_url": self.mimir_hosted_url,
            "sleipnir_publish_urls": list(self.sleipnir_publish_urls),
            "max_concurrent_tasks": self.max_concurrent_tasks,
        }
