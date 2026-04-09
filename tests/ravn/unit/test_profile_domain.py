"""Unit tests for the RavnProfile domain model."""

from __future__ import annotations

import pytest

from ravn.domain.profile import MimirMountRef, RavnProfile


# ---------------------------------------------------------------------------
# MimirMountRef
# ---------------------------------------------------------------------------


class TestMimirMountRef:
    def test_defaults(self) -> None:
        m = MimirMountRef(name="gimle-wiki")
        assert m.name == "gimle-wiki"
        assert m.role == "primary"
        assert m.priority == 10

    def test_custom_values(self) -> None:
        m = MimirMountRef(name="archive", role="read-only", priority=20)
        assert m.role == "read-only"
        assert m.priority == 20


# ---------------------------------------------------------------------------
# RavnProfile construction
# ---------------------------------------------------------------------------


class TestRavnProfileDefaults:
    def test_required_name(self) -> None:
        p = RavnProfile(name="test")
        assert p.name == "test"

    def test_default_identity(self) -> None:
        p = RavnProfile(name="x")
        assert p.rune == "ᚱ"
        assert p.location == ""
        assert p.deployment == "ephemeral"

    def test_default_role(self) -> None:
        p = RavnProfile(name="x")
        assert p.persona == "autonomous-agent"
        assert p.system_prompt_extra == ""
        assert p.specialisations == []

    def test_default_infrastructure(self) -> None:
        p = RavnProfile(name="x")
        assert p.mcp_servers == []
        assert p.gateway_channels == []
        assert p.sleipnir_topics == []
        assert p.output_mode == "ambient"

    def test_default_autonomy(self) -> None:
        p = RavnProfile(name="x")
        assert p.cascade_mode == "local"
        assert p.trigger_names == []

    def test_default_operational(self) -> None:
        p = RavnProfile(name="x")
        assert p.checkpoint_enabled is False
        assert p.checkpoint_strategy == "on_milestone"

    def test_mutable_lists_are_independent(self) -> None:
        p1 = RavnProfile(name="a")
        p2 = RavnProfile(name="b")
        p1.specialisations.append("coding")
        assert p2.specialisations == []


# ---------------------------------------------------------------------------
# RavnProfile construction with values
# ---------------------------------------------------------------------------


class TestRavnProfileCustomValues:
    def test_full_identity(self) -> None:
        p = RavnProfile(
            name="tanngrisnir",
            rune="ᚱ",
            location="gimle",
            deployment="k8s",
        )
        assert p.name == "tanngrisnir"
        assert p.location == "gimle"
        assert p.deployment == "k8s"

    def test_mimir_mounts(self) -> None:
        m = MimirMountRef(name="gimle-wiki", role="primary", priority=5)
        p = RavnProfile(name="x", mimir_mounts=[m])
        assert len(p.mimir_mounts) == 1
        assert p.mimir_mounts[0].name == "gimle-wiki"

    def test_mcp_server_filter(self) -> None:
        p = RavnProfile(name="x", mcp_servers=["linear", "gmail"])
        assert "linear" in p.mcp_servers
        assert "gmail" in p.mcp_servers


# ---------------------------------------------------------------------------
# RavnProfile.to_dict()
# ---------------------------------------------------------------------------


class TestRavnProfileToDict:
    def test_returns_dict(self) -> None:
        p = RavnProfile(name="test")
        d = p.to_dict()
        assert isinstance(d, dict)

    def test_identity_fields_present(self) -> None:
        p = RavnProfile(name="huginn", location="iphone", deployment="mobile")
        d = p.to_dict()
        assert d["name"] == "huginn"
        assert d["location"] == "iphone"
        assert d["deployment"] == "mobile"
        assert d["rune"] == "ᚱ"

    def test_mimir_mounts_serialised(self) -> None:
        p = RavnProfile(
            name="x",
            mimir_mounts=[MimirMountRef(name="wiki", role="archive", priority=20)],
        )
        d = p.to_dict()
        assert d["mimir_mounts"] == [{"name": "wiki", "role": "archive", "priority": 20}]

    def test_lists_are_copies(self) -> None:
        p = RavnProfile(name="x", specialisations=["coding"])
        d = p.to_dict()
        d["specialisations"].append("extra")
        assert p.specialisations == ["coding"]

    def test_all_expected_keys_present(self) -> None:
        p = RavnProfile(name="x")
        d = p.to_dict()
        expected_keys = {
            "name", "rune", "location", "deployment",
            "persona", "system_prompt_extra", "specialisations",
            "fallback_model",
            "mcp_servers", "gateway_channels", "sleipnir_topics", "output_mode",
            "mimir_mounts", "mimir_write_routing",
            "cascade_mode", "trigger_names",
            "checkpoint_enabled", "checkpoint_strategy",
        }
        assert expected_keys == set(d.keys())
