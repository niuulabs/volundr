"""Tests for ThreadConfig (NIU-555)."""

from __future__ import annotations

from ravn.config import Settings, ThreadConfig


class TestThreadConfig:
    def test_defaults(self) -> None:
        c = ThreadConfig()
        assert c.decay_half_life_days == 7.0
        assert c.initial_weight == 0.5
        assert c.importance_default == 1.0
        assert c.weight_floor == 0.05
        assert c.enrichment_model == "claude-haiku-4-5-20251001"
        assert c.enrichment_max_tokens == 256
        assert c.queue_batch_size == 10
        assert c.dsn == ""
        assert c.dsn_env == ""

    def test_custom_values(self) -> None:
        c = ThreadConfig(
            decay_half_life_days=14.0,
            initial_weight=0.8,
            queue_batch_size=5,
        )
        assert c.decay_half_life_days == 14.0
        assert c.initial_weight == 0.8
        assert c.queue_batch_size == 5


class TestSettingsHasThreadConfig:
    def test_settings_has_thread_field(self) -> None:
        s = Settings()
        assert hasattr(s, "thread")
        assert isinstance(s.thread, ThreadConfig)

    def test_thread_defaults_in_settings(self) -> None:
        s = Settings()
        assert s.thread.decay_half_life_days == 7.0
        assert s.thread.queue_batch_size == 10
