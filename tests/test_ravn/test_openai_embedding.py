"""Tests for OpenAIEmbeddingAdapter — all HTTP mocked with respx."""

from __future__ import annotations

import pytest
import respx
from httpx import Response

from ravn.adapters.openai_embedding import (
    _DEFAULT_DIMENSION,
    _DEFAULT_MODEL,
    OpenAIEmbeddingAdapter,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_response(vectors: list[list[float]]) -> dict:
    return {
        "object": "list",
        "data": [
            {"object": "embedding", "index": i, "embedding": v} for i, v in enumerate(vectors)
        ],
        "model": _DEFAULT_MODEL,
        "usage": {"prompt_tokens": 8, "total_tokens": 8},
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestOpenAIEmbeddingAdapter:
    def test_default_dimension_before_call(self) -> None:
        adapter = OpenAIEmbeddingAdapter(api_key="test-key")
        assert adapter.dimension == _DEFAULT_DIMENSION

    def test_api_key_from_constructor(self) -> None:
        adapter = OpenAIEmbeddingAdapter(api_key="sk-abc")
        assert adapter._api_key == "sk-abc"

    def test_api_key_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
        adapter = OpenAIEmbeddingAdapter()
        assert adapter._api_key == "sk-env"

    @respx.mock
    async def test_embed_returns_vector(self) -> None:
        vec = [0.1, 0.2, 0.3]
        respx.post("https://api.openai.com/v1/embeddings").mock(
            return_value=Response(200, json=_make_response([vec]))
        )
        adapter = OpenAIEmbeddingAdapter(api_key="test")
        result = await adapter.embed("hello")
        assert result == pytest.approx(vec)

    @respx.mock
    async def test_embed_batch_preserves_order(self) -> None:
        vecs = [[1.0, 0.0], [0.0, 1.0], [0.5, 0.5]]
        # Return in shuffled order — adapter must re-sort by index.
        shuffled_data = [
            {"object": "embedding", "index": 2, "embedding": vecs[2]},
            {"object": "embedding", "index": 0, "embedding": vecs[0]},
            {"object": "embedding", "index": 1, "embedding": vecs[1]},
        ]
        respx.post("https://api.openai.com/v1/embeddings").mock(
            return_value=Response(
                200,
                json={"object": "list", "data": shuffled_data, "model": _DEFAULT_MODEL},
            )
        )
        adapter = OpenAIEmbeddingAdapter(api_key="test")
        result = await adapter.embed_batch(["a", "b", "c"])
        assert result[0] == pytest.approx(vecs[0])
        assert result[1] == pytest.approx(vecs[1])
        assert result[2] == pytest.approx(vecs[2])

    @respx.mock
    async def test_dimension_updated_after_call(self) -> None:
        vec = [0.1] * 768
        respx.post("https://api.openai.com/v1/embeddings").mock(
            return_value=Response(200, json=_make_response([vec]))
        )
        adapter = OpenAIEmbeddingAdapter(api_key="test")
        await adapter.embed("text")
        assert adapter.dimension == 768

    @respx.mock
    async def test_http_error_propagates(self) -> None:
        respx.post("https://api.openai.com/v1/embeddings").mock(
            return_value=Response(401, json={"error": "Unauthorized"})
        )
        adapter = OpenAIEmbeddingAdapter(api_key="bad-key")
        with pytest.raises(Exception):
            await adapter.embed("text")

    @respx.mock
    async def test_custom_base_url(self) -> None:
        vec = [0.1, 0.2]
        respx.post("https://my-proxy.example.com/v1/embeddings").mock(
            return_value=Response(200, json=_make_response([vec]))
        )
        adapter = OpenAIEmbeddingAdapter(api_key="test", base_url="https://my-proxy.example.com/v1")
        result = await adapter.embed("hello")
        assert result == pytest.approx(vec)

    @respx.mock
    async def test_embed_batch_empty_list_skips_request(self) -> None:
        """Empty batch should still call the API (API handles it)."""
        respx.post("https://api.openai.com/v1/embeddings").mock(
            return_value=Response(200, json={"object": "list", "data": [], "model": _DEFAULT_MODEL})
        )
        adapter = OpenAIEmbeddingAdapter(api_key="test")
        result = await adapter.embed_batch([])
        assert result == []
