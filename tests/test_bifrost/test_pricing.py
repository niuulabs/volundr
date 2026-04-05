"""Tests for bifrost.pricing — cost calculation."""

from __future__ import annotations

import pytest

from bifrost.domain.models import TokenUsage
from bifrost.pricing import BUILTIN_PRICING, ModelPricing, calculate_cost


class TestBuiltinPricing:
    def test_anthropic_models_present(self):
        assert "claude-opus-4-6" in BUILTIN_PRICING
        assert "claude-sonnet-4-6" in BUILTIN_PRICING
        assert "claude-haiku-4-5-20251001" in BUILTIN_PRICING

    def test_openai_models_present(self):
        assert "gpt-4o" in BUILTIN_PRICING
        assert "gpt-4o-mini" in BUILTIN_PRICING

    def test_ollama_free(self):
        pricing = BUILTIN_PRICING["llama3.1:8b"]
        assert pricing.input_per_million == 0.0
        assert pricing.output_per_million == 0.0

    def test_opus_more_expensive_than_sonnet(self):
        opus = BUILTIN_PRICING["claude-opus-4-6"]
        sonnet = BUILTIN_PRICING["claude-sonnet-4-6"]
        assert opus.output_per_million > sonnet.output_per_million


class TestCalculateCost:
    def test_zero_usage_returns_zero(self):
        usage = TokenUsage()
        cost = calculate_cost("claude-sonnet-4-6", usage)
        assert cost == 0.0

    def test_input_tokens_only(self):
        usage = TokenUsage(input_tokens=1_000_000)
        cost = calculate_cost("claude-sonnet-4-6", usage)
        expected = BUILTIN_PRICING["claude-sonnet-4-6"].input_per_million
        assert abs(cost - expected) < 1e-9

    def test_output_tokens_only(self):
        usage = TokenUsage(output_tokens=1_000_000)
        cost = calculate_cost("claude-opus-4-6", usage)
        expected = BUILTIN_PRICING["claude-opus-4-6"].output_per_million
        assert abs(cost - expected) < 1e-9

    def test_combined_tokens(self):
        usage = TokenUsage(input_tokens=100_000, output_tokens=50_000)
        pricing = BUILTIN_PRICING["claude-sonnet-4-6"]
        expected = (
            100_000 * pricing.input_per_million / 1_000_000
            + 50_000 * pricing.output_per_million / 1_000_000
        )
        cost = calculate_cost("claude-sonnet-4-6", usage)
        assert abs(cost - expected) < 1e-9

    def test_cache_tokens_included(self):
        usage = TokenUsage(
            input_tokens=0,
            output_tokens=0,
            cache_creation_input_tokens=1_000_000,
            cache_read_input_tokens=1_000_000,
        )
        pricing = BUILTIN_PRICING["claude-sonnet-4-6"]
        expected = pricing.cache_creation_per_million + pricing.cache_read_per_million
        cost = calculate_cost("claude-sonnet-4-6", usage)
        assert abs(cost - expected) < 1e-9

    def test_unknown_model_returns_zero(self):
        usage = TokenUsage(input_tokens=1000, output_tokens=500)
        assert calculate_cost("totally-unknown-model", usage) == 0.0

    def test_free_model_returns_zero(self):
        usage = TokenUsage(input_tokens=500_000, output_tokens=200_000)
        assert calculate_cost("llama3.1:8b", usage) == 0.0

    def test_overrides_take_precedence(self):
        usage = TokenUsage(input_tokens=1_000_000)
        override = {"claude-sonnet-4-6": ModelPricing(input_per_million=99.0)}
        cost = calculate_cost("claude-sonnet-4-6", usage, overrides=override)
        assert abs(cost - 99.0) < 1e-9

    def test_overrides_can_add_new_model(self):
        usage = TokenUsage(output_tokens=1_000_000)
        override = {"custom-model": ModelPricing(output_per_million=7.5)}
        cost = calculate_cost("custom-model", usage, overrides=override)
        assert abs(cost - 7.5) < 1e-9

    def test_override_does_not_affect_other_models(self):
        usage = TokenUsage(input_tokens=1_000_000)
        override = {"claude-opus-4-6": ModelPricing(input_per_million=999.0)}
        cost = calculate_cost("claude-sonnet-4-6", usage, overrides=override)
        expected = BUILTIN_PRICING["claude-sonnet-4-6"].input_per_million
        assert abs(cost - expected) < 1e-9

    @pytest.mark.parametrize(
        "model,input_tok,output_tok",
        [
            ("claude-haiku-4-5-20251001", 10_000, 5_000),
            ("gpt-4o-mini", 20_000, 10_000),
            ("gpt-4o", 500, 200),
        ],
    )
    def test_parametrised_models(self, model: str, input_tok: int, output_tok: int):
        usage = TokenUsage(input_tokens=input_tok, output_tokens=output_tok)
        pricing = BUILTIN_PRICING[model]
        expected = (
            input_tok * pricing.input_per_million / 1_000_000
            + output_tok * pricing.output_per_million / 1_000_000
        )
        cost = calculate_cost(model, usage)
        assert abs(cost - expected) < 1e-9
