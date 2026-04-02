"""Tests for the plugin registry."""

from __future__ import annotations

from cli.plugins import PLUGIN_REGISTRY


class TestPluginRegistry:
    """Tests for the PLUGIN_REGISTRY."""

    def test_registry_is_dict(self):
        assert isinstance(PLUGIN_REGISTRY, dict)

    def test_all_expected_commands_registered(self):
        expected = {"up", "down", "migrate", "status", "serve"}
        assert expected == set(PLUGIN_REGISTRY.keys())

    def test_all_plugins_have_description(self):
        for name, plugin in PLUGIN_REGISTRY.items():
            assert hasattr(plugin, "description"), f"{name} missing description"
            assert plugin.description, f"{name} has empty description"

    def test_all_plugins_have_register_method(self):
        for name, plugin in PLUGIN_REGISTRY.items():
            assert hasattr(plugin, "register"), f"{name} missing register()"

    def test_all_plugins_have_run_method(self):
        for name, plugin in PLUGIN_REGISTRY.items():
            assert hasattr(plugin, "run"), f"{name} missing run()"
