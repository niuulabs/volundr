"""Hardcoded pricing provider adapter."""

from volundr.domain.models import Model, ModelProvider, ModelTier
from volundr.domain.ports import PricingProvider

# Pricing per million tokens in USD
PRICING: dict[str, float] = {
    "claude-opus-4-20250514": 15.00,
    "claude-sonnet-4-20250514": 3.00,
    "claude-3-5-haiku-20241022": 0.25,
}

# All available models with metadata
MODELS: list[Model] = [
    Model(
        id="claude-opus-4-20250514",
        name="Claude Opus 4",
        description="Most capable model for complex tasks",
        provider=ModelProvider.CLOUD,
        tier=ModelTier.FRONTIER,
        color="#7C3AED",
        cost_per_million_tokens=15.00,
    ),
    Model(
        id="claude-sonnet-4-20250514",
        name="Claude Sonnet 4",
        description="Fast, intelligent model for everyday tasks",
        provider=ModelProvider.CLOUD,
        tier=ModelTier.BALANCED,
        color="#2563EB",
        cost_per_million_tokens=3.00,
    ),
    Model(
        id="claude-3-5-haiku-20241022",
        name="Claude 3.5 Haiku",
        description="Fastest model for simple tasks",
        provider=ModelProvider.CLOUD,
        tier=ModelTier.EXECUTION,
        color="#10B981",
        cost_per_million_tokens=0.25,
    ),
    Model(
        id="llama3.2:latest",
        name="Llama 3.2",
        description="Open source model running locally via Ollama",
        provider=ModelProvider.LOCAL,
        tier=ModelTier.BALANCED,
        color="#F59E0B",
        cost_per_million_tokens=None,
        vram_required="8GB",
    ),
    Model(
        id="codellama:latest",
        name="Code Llama",
        description="Specialized coding model running locally via Ollama",
        provider=ModelProvider.LOCAL,
        tier=ModelTier.EXECUTION,
        color="#EF4444",
        cost_per_million_tokens=None,
        vram_required="16GB",
    ),
    Model(
        id="deepseek-r1:latest",
        name="DeepSeek R1",
        description="Advanced reasoning model running locally via Ollama",
        provider=ModelProvider.LOCAL,
        tier=ModelTier.REASONING,
        color="#8B5CF6",
        cost_per_million_tokens=None,
        vram_required="32GB",
    ),
]


class HardcodedPricingProvider(PricingProvider):
    """Pricing provider with hardcoded model data."""

    def get_price(self, model_id: str) -> float | None:
        """Get the price per million tokens for a model."""
        return PRICING.get(model_id)

    def list_models(self) -> list[Model]:
        """List all available models with pricing and metadata."""
        return MODELS.copy()
