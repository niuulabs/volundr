"""OpenAI embeddings adapter.

Calls the OpenAI ``/v1/embeddings`` endpoint using ``httpx``.  No OpenAI SDK
dependency required — only ``httpx``, which is already a project dependency.
"""

from __future__ import annotations

import os

import httpx

from ravn.ports.embedding import EmbeddingPort

_DEFAULT_MODEL = "text-embedding-3-small"
_DEFAULT_BASE_URL = "https://api.openai.com/v1"
# text-embedding-3-small default dimension
_DEFAULT_DIMENSION = 1536


class OpenAIEmbeddingAdapter(EmbeddingPort):
    """Embedding adapter using OpenAI's embeddings API.

    Args:
        api_key: OpenAI API key.  When empty the ``OPENAI_API_KEY`` env var is used.
        model: Embedding model name.
        base_url: Base URL for the OpenAI (or compatible) API.
        timeout: HTTP request timeout in seconds.
    """

    def __init__(
        self,
        api_key: str = "",
        *,
        model: str = _DEFAULT_MODEL,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._dimension: int | None = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _post_embeddings(self, texts: list[str]) -> list[list[float]]:
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.post(
                f"{self._base_url}/embeddings",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={"input": texts, "model": self._model},
            )
            response.raise_for_status()
            data = response.json()

        sorted_items = sorted(data["data"], key=lambda x: x["index"])
        vectors = [item["embedding"] for item in sorted_items]
        if vectors and self._dimension is None:
            self._dimension = len(vectors[0])
        return vectors

    # ------------------------------------------------------------------
    # EmbeddingPort
    # ------------------------------------------------------------------

    async def embed(self, text: str) -> list[float]:
        vectors = await self.embed_batch([text])
        return vectors[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return await self._post_embeddings(texts)

    @property
    def dimension(self) -> int:
        if self._dimension is not None:
            return self._dimension
        return _DEFAULT_DIMENSION
