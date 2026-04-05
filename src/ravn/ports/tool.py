"""Tool port — interface for agent tools."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ravn.domain.models import ToolResult


class ToolPort(ABC):
    """Abstract interface for a tool the agent can call."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique tool name used by the LLM."""
        ...

    @property
    @abstractmethod
    def description(self) -> str:
        """Human-readable description of what the tool does."""
        ...

    @property
    @abstractmethod
    def input_schema(self) -> dict:
        """JSON Schema for the tool's input parameters."""
        ...

    @property
    @abstractmethod
    def required_permission(self) -> str:
        """Permission string that must be granted before this tool executes."""
        ...

    @abstractmethod
    async def execute(self, input: dict) -> ToolResult:
        """Execute the tool with the given input and return a result."""
        ...

    def to_api_dict(self) -> dict:
        """Serialize to the Anthropic tool definition format."""
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }
