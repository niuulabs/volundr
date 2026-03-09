"""Tests for the pricing provider adapter."""

import pytest

from volundr.adapters.outbound.pricing import (
    MODELS,
    PRICING,
    HardcodedPricingProvider,
)
from volundr.domain.models import ModelProvider, ModelTier


class TestHardcodedPricingProvider:
    """Tests for HardcodedPricingProvider."""

    @pytest.fixture
    def provider(self) -> HardcodedPricingProvider:
        """Create a pricing provider."""
        return HardcodedPricingProvider()

    def test_get_price_cloud_model(self, provider: HardcodedPricingProvider):
        """Returns price for cloud models."""
        price = provider.get_price("claude-opus-4-20250514")
        assert price == 15.00

        price = provider.get_price("claude-sonnet-4-20250514")
        assert price == 3.00

        price = provider.get_price("claude-3-5-haiku-20241022")
        assert price == 0.25

    def test_get_price_local_model_returns_none(self, provider: HardcodedPricingProvider):
        """Returns None for local models (not in pricing dict)."""
        price = provider.get_price("llama3.2:latest")
        assert price is None

    def test_get_price_unknown_model_returns_none(self, provider: HardcodedPricingProvider):
        """Returns None for unknown models."""
        price = provider.get_price("nonexistent-model")
        assert price is None

    def test_list_models_returns_all_models(self, provider: HardcodedPricingProvider):
        """Returns all configured models."""
        models = provider.list_models()
        assert len(models) == len(MODELS)

    def test_list_models_returns_copy(self, provider: HardcodedPricingProvider):
        """Returns a copy of models list, not the original."""
        models1 = provider.list_models()
        models2 = provider.list_models()
        assert models1 is not models2

    def test_list_models_contains_cloud_models(self, provider: HardcodedPricingProvider):
        """Models list includes cloud models."""
        models = provider.list_models()
        cloud_models = [m for m in models if m.provider == ModelProvider.CLOUD]

        assert len(cloud_models) >= 3
        model_ids = [m.id for m in cloud_models]
        assert "claude-opus-4-20250514" in model_ids
        assert "claude-sonnet-4-20250514" in model_ids
        assert "claude-3-5-haiku-20241022" in model_ids

    def test_list_models_contains_local_models(self, provider: HardcodedPricingProvider):
        """Models list includes local models."""
        models = provider.list_models()
        local_models = [m for m in models if m.provider == ModelProvider.LOCAL]

        assert len(local_models) >= 1
        for model in local_models:
            assert model.cost_per_million_tokens is None
            assert model.vram_required is not None

    def test_cloud_models_have_pricing(self, provider: HardcodedPricingProvider):
        """All cloud models have pricing information."""
        models = provider.list_models()
        cloud_models = [m for m in models if m.provider == ModelProvider.CLOUD]

        for model in cloud_models:
            assert model.cost_per_million_tokens is not None
            assert model.cost_per_million_tokens > 0

    def test_local_models_have_vram(self, provider: HardcodedPricingProvider):
        """All local models have VRAM requirements."""
        models = provider.list_models()
        local_models = [m for m in models if m.provider == ModelProvider.LOCAL]

        for model in local_models:
            assert model.vram_required is not None

    def test_all_models_have_required_fields(self, provider: HardcodedPricingProvider):
        """All models have required fields."""
        models = provider.list_models()

        for model in models:
            assert model.id
            assert model.name
            assert model.description
            assert model.provider in (ModelProvider.CLOUD, ModelProvider.LOCAL)
            assert model.tier in (
                ModelTier.FRONTIER,
                ModelTier.BALANCED,
                ModelTier.EXECUTION,
                ModelTier.REASONING,
            )
            assert model.color
            assert model.color.startswith("#")

    def test_pricing_matches_model_cost(self, provider: HardcodedPricingProvider):
        """PRICING dict matches model cost_per_million_tokens."""
        models = provider.list_models()

        for model in models:
            expected_price = provider.get_price(model.id)
            assert model.cost_per_million_tokens == expected_price


class TestPricingConstants:
    """Tests for pricing module constants."""

    def test_pricing_dict_has_expected_models(self):
        """PRICING dict contains expected cloud models."""
        assert "claude-opus-4-20250514" in PRICING
        assert "claude-sonnet-4-20250514" in PRICING
        assert "claude-3-5-haiku-20241022" in PRICING

    def test_pricing_values_are_positive(self):
        """All pricing values are positive."""
        for model_id, price in PRICING.items():
            assert price > 0, f"Price for {model_id} should be positive"

    def test_models_list_not_empty(self):
        """MODELS list is not empty."""
        assert len(MODELS) > 0

    def test_models_have_unique_ids(self):
        """All models have unique IDs."""
        model_ids = [m.id for m in MODELS]
        assert len(model_ids) == len(set(model_ids))
