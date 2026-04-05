"""Ollama local embedding adapter.

Calls Ollama's ``/api/embed`` endpoint using ``httpx``.  Requires a running
Ollama instance (``ollama serve``) with the embedding model pulled.

Example::

    adapter = OllamaEmbeddingAdapter(model="nomic-embed-text")
    vector = await adapter.embed("some text")
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

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _post_embed(self, text: str) -> list[float]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self._base_url}/api/embed",
                json={"model": self._model, "input": text},
            )
            response.raise_for_status()
            data = response.json()
        embedding: list[float] = data["embeddings"][0]
        if self._dimension is None:
            self._dimension = len(embedding)
        return embedding

    # ------------------------------------------------------------------
    # EmbeddingPort
    # ------------------------------------------------------------------

    async def embed(self, text: str) -> list[float]:
        return await self._post_embed(text)

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        results: list[list[float]] = []
        for text in texts:
            vec = await self._post_embed(text)
            results.append(vec)
        return results

    @property
    def dimension(self) -> int:
        if self._dimension is not None:
            return self._dimension
        return _DEFAULT_DIMENSION
