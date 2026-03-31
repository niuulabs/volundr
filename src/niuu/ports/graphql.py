"""GraphQL client port — abstract interface for GraphQL API clients."""

from __future__ import annotations

from abc import ABC, abstractmethod


class GraphQLClientPort(ABC):
    """Abstract GraphQL client with caching support."""

    @abstractmethod
    async def query(
        self,
        query: str,
        variables: dict | None = None,
    ) -> dict:
        """Execute a GraphQL query and return the data payload.

        Args:
            query: The GraphQL query or mutation string.
            variables: Optional variables for the query.

        Returns:
            The ``data`` dict from the GraphQL response.

        Raises:
            GraphQLError: If the response contains errors.
            httpx.HTTPStatusError: On non-2xx responses.
        """

    @abstractmethod
    async def close(self) -> None:
        """Close the underlying HTTP client."""
