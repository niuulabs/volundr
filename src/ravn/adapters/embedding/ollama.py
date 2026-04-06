"""Ollama local embedding adapter.

Calls Ollama's ``/api/embed`` endpoint using ``httpx``.  Requires a running
Ollama instance (``ollama serve``) with the embedding model pulled.

A single persistent ``httpx.AsyncClient`` is reused across calls to avoid
the overhead of creating a new TCP connection pool for each request.
Call ``await adapter.close()`` when done to release the connection pool.

Example::

    adapter = OllamaEmbeddingAdapter(model="nomic-embed-text")
    vector = await adapter.embed("some text")
    await adapter.close()
"""

from __future__ import annotations

import httpx

from ravn.ports.embedding import EmbeddingPort

_DEFAULT_MODEL = "nomic-embed-text"
_DEFAULT_BASE_URL = "http://localhost:11434"
# nomic-embed-text default dimension
_DEFAULT_DIMENSION = 768


class OllamaEmbeddingAdapter(EmbeddingPort):
    """Embedding adapter using a locally-running Ollama instance.

    Args:
        model: Ollama model name (must support embeddings).
        base_url: URL of the Ollama API server.
        timeout: HTTP request timeout in seconds.
    """

    def __init__(
        self,
        *,
        model: str = _DEFAULT_MODEL,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> None:
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._dimension: int | None = None
        self._client: httpx.AsyncClient | None = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def close(self) -> None:
        """Close the persistent HTTP client and release connection pool."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _post_embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Send all *texts* in a single /api/embed request (batch input)."""
        response = await self._get_client().post(
            f"{self._base_url}/api/embed",
            json={"model": self._model, "input": texts},
        )
        response.raise_for_status()
        data = response.json()
        embeddings: list[list[float]] = data["embeddings"]
        if self._dimension is None and embeddings:
            self._dimension = len(embeddings[0])
        return embeddings

    # ------------------------------------------------------------------
    # EmbeddingPort
    # ------------------------------------------------------------------

    async def embed(self, text: str) -> list[float]:
        results = await self._post_embed_batch([text])
        return results[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return await self._post_embed_batch(texts)

    @property
    def dimension(self) -> int:
        if self._dimension is not None:
            return self._dimension
        return _DEFAULT_DIMENSION
