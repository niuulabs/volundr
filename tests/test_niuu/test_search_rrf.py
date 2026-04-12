"""Tests for niuu.adapters.search.rrf — cosine_similarity and reciprocal_rank_fusion."""

from __future__ import annotations

import math

import pytest

from niuu.adapters.search.rrf import cosine_similarity, reciprocal_rank_fusion


class TestCosineSimilarity:
    def test_identical_vectors(self) -> None:
        v = [1.0, 0.0, 0.0]
        assert cosine_similarity(v, v) == pytest.approx(1.0)

    def test_orthogonal_vectors(self) -> None:
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert cosine_similarity(a, b) == pytest.approx(0.0)

    def test_opposite_vectors(self) -> None:
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert cosine_similarity(a, b) == pytest.approx(-1.0)

    def test_zero_vector_returns_zero(self) -> None:
        a = [0.0, 0.0, 0.0]
        b = [1.0, 2.0, 3.0]
        assert cosine_similarity(a, b) == pytest.approx(0.0)

    def test_mismatched_length_returns_zero(self) -> None:
        a = [1.0, 2.0]
        b = [1.0, 2.0, 3.0]
        assert cosine_similarity(a, b) == pytest.approx(0.0)

    def test_empty_vectors_returns_zero(self) -> None:
        assert cosine_similarity([], []) == pytest.approx(0.0)

    def test_unit_vector_similarity(self) -> None:
        a = [1.0, 1.0]
        b = [1.0, 1.0]
        assert cosine_similarity(a, b) == pytest.approx(1.0)

    def test_partial_overlap(self) -> None:
        a = [1.0, 0.0]
        b = [1.0, 1.0]
        # cos(45°) = 1/√2
        expected = 1.0 / math.sqrt(2)
        assert cosine_similarity(a, b) == pytest.approx(expected)


class TestReciprocalRankFusion:
    def test_single_ranking(self) -> None:
        scores = reciprocal_rank_fusion([["a", "b", "c"]], k=60)
        # rank 0 → 1/(60+0+1), rank 1 → 1/(60+1+1), rank 2 → 1/(60+2+1)
        assert scores["a"] == pytest.approx(1 / 61)
        assert scores["b"] == pytest.approx(1 / 62)
        assert scores["c"] == pytest.approx(1 / 63)

    def test_two_rankings_boost_shared_doc(self) -> None:
        keyword = ["a", "b", "c"]
        semantic = ["c", "b", "a"]
        scores = reciprocal_rank_fusion([keyword, semantic], k=60)
        # "a" ranks #0 in keyword and #2 in semantic → score = 1/61 + 1/63
        # "c" ranks #2 in keyword and #0 in semantic → score = 1/63 + 1/61 (same as "a")
        # All three appear in both lists so all get non-zero contributions from both
        assert scores["a"] > 0
        assert scores["b"] > 0
        assert scores["c"] > 0
        # "a" and "c" are symmetric reflections, so their scores are equal
        assert scores["a"] == pytest.approx(scores["c"])

    def test_document_only_in_one_list(self) -> None:
        scores = reciprocal_rank_fusion([["a", "b"], ["a", "c"]], k=60)
        # "a" appears in both → boosted
        # "b" and "c" each appear once at rank 1
        assert scores["a"] > scores["b"]
        assert scores["a"] > scores["c"]

    def test_rrf_delivery_criterion(self) -> None:
        """Doc ranked #3 keyword + #5 semantic beats a doc ranked #1 semantic only."""
        k = 60
        keyword = ["x", "y", "z", "doc_a", "other"]  # doc_a at rank 3
        semantic = ["doc_b", "x", "y", "z", "other", "doc_a"]  # doc_b at rank 0, doc_a at rank 5

        scores = reciprocal_rank_fusion([keyword, semantic], k=k)

        # doc_a: 1/(k+3+1) + 1/(k+5+1) = 1/64 + 1/66 ≈ 0.03088
        # doc_b: 0          + 1/(k+0+1) = 1/61 ≈ 0.01639
        assert scores["doc_a"] > scores["doc_b"], (
            f"doc_a score {scores['doc_a']:.5f} should beat doc_b {scores['doc_b']:.5f}"
        )

    def test_empty_rankings(self) -> None:
        scores = reciprocal_rank_fusion([], k=60)
        assert scores == {}

    def test_default_k(self) -> None:
        scores = reciprocal_rank_fusion([["a"]])
        assert scores["a"] == pytest.approx(1 / 61)
