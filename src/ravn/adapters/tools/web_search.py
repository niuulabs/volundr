"""WebSearchTool — search the web via a configurable provider adapter."""

from __future__ import annotations

import json

from ravn.domain.models import ToolResult
from ravn.ports.tool import ToolPort
from ravn.ports.web_search import SearchResult, WebSearchPort

_DEFAULT_NUM_RESULTS = 5

# ---------------------------------------------------------------------------
# Mock provider (default / testing)
# ---------------------------------------------------------------------------


class MockWebSearchProvider(WebSearchPort):
    """In-memory search provider for tests and offline environments.

    Returns a fixed list of canned results regardless of the query.
    Callers may pass a custom ``results`` list to control the output.
    """

    _DEFAULT_RESULTS: list[SearchResult] = [
        SearchResult(
            title="Example Domain",
            url="https://example.com",
            snippet="This domain is for use in illustrative examples.",
        ),
        SearchResult(
            title="Python Documentation",
            url="https://docs.python.org",
            snippet="The official Python programming language documentation.",
        ),
        SearchResult(
            title="GitHub",
            url="https://github.com",
            snippet="Where the world builds software.",
        ),
    ]

    def __init__(self, results: list[SearchResult] | None = None) -> None:
        self._results = results if results is not None else list(self._DEFAULT_RESULTS)

    async def search(self, query: str, *, num_results: int) -> list[SearchResult]:
        return self._results[:num_results]


# ---------------------------------------------------------------------------
# Tool implementation
# ---------------------------------------------------------------------------


class WebSearchTool(ToolPort):
    """Search the web and return a list of results.

    The search provider is injected at construction time following the
    dynamic adapter pattern — configure via the ``adapter`` key in YAML.
    """

    def __init__(
        self,
        provider: WebSearchPort | None = None,
        *,
        num_results: int = _DEFAULT_NUM_RESULTS,
    ) -> None:
        self._provider: WebSearchPort = provider or MockWebSearchProvider()
        self._num_results = num_results

    @property
    def name(self) -> str:
        return "web_search"

    @property
    def description(self) -> str:
        return (
            "Search the web for information. "
            "Returns a list of results with titles, URLs, and snippets. "
            "Use this to find current information, documentation, or references."
        )

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query.",
                },
                "num_results": {
                    "type": "integer",
                    "description": (
                        f"Number of results to return (default: {_DEFAULT_NUM_RESULTS})."
                    ),
                },
            },
            "required": ["query"],
        }

    @property
    def required_permission(self) -> str:
        return "web:search"

    async def execute(self, input: dict) -> ToolResult:
        query = input.get("query", "").strip()
        num_results = int(input.get("num_results", self._num_results))

        if not query:
            return ToolResult(tool_call_id="", content="query is required", is_error=True)

        results = await self._provider.search(query, num_results=num_results)

        if not results:
            return ToolResult(tool_call_id="", content="No results found.")

        lines = [f"{i + 1}. {r.title}\n   {r.url}\n   {r.snippet}" for i, r in enumerate(results)]
        return ToolResult(tool_call_id="", content="\n\n".join(lines))

    def _results_to_json(self, results: list[SearchResult]) -> str:
        return json.dumps(
            [{"title": r.title, "url": r.url, "snippet": r.snippet} for r in results],
            indent=2,
        )
