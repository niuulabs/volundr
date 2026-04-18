"""Port interface for FlockFlowProvider — storage-agnostic CRUD for flock flows."""

from __future__ import annotations

from abc import ABC, abstractmethod

from tyr.domain.flock_flow import FlockFlowConfig


class FlockFlowProvider(ABC):
    """Abstract provider for named flock flow configurations.

    Implementations ship with Tyr:
    - ``ConfigFlockFlowProvider`` — YAML file at startup + in-memory runtime mutations.
    - ``KubernetesConfigMapFlockFlowProvider`` — read/write through a k8s ConfigMap.
    """

    @abstractmethod
    def get(self, name: str) -> FlockFlowConfig | None:
        """Return the flow with *name*, or ``None`` if it does not exist."""

    @abstractmethod
    def list(self) -> list[FlockFlowConfig]:
        """Return all available flows."""

    @abstractmethod
    def save(self, flow: FlockFlowConfig) -> None:
        """Upsert *flow* (create or replace by name)."""

    @abstractmethod
    def delete(self, name: str) -> bool:
        """Remove the flow with *name*.

        Returns ``True`` if the flow existed and was removed, ``False`` otherwise.
        """
