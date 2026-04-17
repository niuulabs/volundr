"""Tests for RavnFlockContributor."""

from unittest.mock import MagicMock

import pytest

from volundr.adapters.outbound.contributors.core import CoreSessionContributor
from volundr.adapters.outbound.contributors.ravn_flock import (
    RavnFlockContributor,
    _gateway_port_for,
    _ports_for,
)
from volundr.domain.models import (
    ForgeProfile,
    GitSource,
    Session,
    SessionSpec,
    WorkspaceTemplate,
)
from volundr.domain.ports import SessionContext

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def session():
    return Session(name="test-flock", model="claude-sonnet-4-20250514", source=GitSource())


@pytest.fixture
def flock_template():
    return WorkspaceTemplate(
        name="ravn-flock",
        workload_type="ravn_flock",
        workload_config={
            "personas": ["coordinator", "reviewer"],
            "mesh": {"transport": "nng"},
            "mimir": {"hosted_url": "https://mimir.niuu.internal/api/v1"},
            "sleipnir": {
                "publish_urls": [
                    "http://tyr:8080/sleipnir/events",
                    "http://volundr:8000/sleipnir/events",
                ]
            },
        },
    )


@pytest.fixture
def flock_profile():
    return ForgeProfile(
        name="ravn-flock",
        workload_type="ravn_flock",
        workload_config={
            "personas": ["coordinator", "reviewer"],
            "mesh": {"transport": "nng"},
            "mimir": {},
            "sleipnir": {"publish_urls": ["http://tyr:8080/sleipnir/events"]},
        },
    )


@pytest.fixture
def session_template():
    return WorkspaceTemplate(
        name="default",
        workload_type="session",
        workload_config={},
    )


# ---------------------------------------------------------------------------
# Port allocation
# ---------------------------------------------------------------------------


class TestPortAllocation:
    def test_ports_for_index_0(self):
        pub, rep, hs = _ports_for(0, 7480)
        assert pub == 7480
        assert rep == 7481
        assert hs == 7580

    def test_ports_for_index_1(self):
        pub, rep, hs = _ports_for(1, 7480)
        assert pub == 7482
        assert rep == 7483
        assert hs == 7581

    def test_ports_for_index_2(self):
        pub, rep, hs = _ports_for(2, 7480)
        assert pub == 7484
        assert rep == 7485
        assert hs == 7582

    def test_gateway_port_for_index_0(self):
        assert _gateway_port_for(0, 7480) == 7680

    def test_gateway_port_for_index_1(self):
        assert _gateway_port_for(1, 7480) == 7681

    def test_no_port_collisions_for_n_ravens(self):
        """Verify skuld + N ravn nodes have unique ports."""
        n_personas = 5
        all_ports: set[int] = set()

        for i in range(n_personas + 1):  # index 0 = skuld, 1..N = ravn
            pub, rep, hs = _ports_for(i, 7480)
            gw = _gateway_port_for(i, 7480)
            for p in (pub, rep, hs, gw):
                assert p not in all_ports, f"Port collision at index {i}: port {p}"
                all_ports.add(p)

    def test_custom_base_port(self):
        pub, rep, hs = _ports_for(0, 8000)
        assert pub == 8000
        assert rep == 8001
        assert hs == 8100


# ---------------------------------------------------------------------------
# Name
# ---------------------------------------------------------------------------


class TestRavnFlockContributorName:
    def test_name(self):
        c = RavnFlockContributor()
        assert c.name == "ravn_flock"


# ---------------------------------------------------------------------------
# Workload type routing
# ---------------------------------------------------------------------------


class TestWorkloadTypeRouting:
    async def test_session_workload_type_returns_empty(self, session, session_template):
        provider = MagicMock()
        provider.get.return_value = session_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="default")
        result = await c.contribute(session, ctx)
        assert result.values == {}
        assert result.pod_spec is None

    async def test_ravn_flock_workload_type_contributes(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)
        assert result.values != {} or result.pod_spec is not None

    async def test_no_provider_returns_empty(self, session):
        c = RavnFlockContributor()
        result = await c.contribute(session, SessionContext())
        assert result.values == {}
        assert result.pod_spec is None

    async def test_no_personas_returns_empty(self, session):
        template = WorkspaceTemplate(
            name="no-personas",
            workload_type="ravn_flock",
            workload_config={"personas": []},
        )
        provider = MagicMock()
        provider.get.return_value = template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="no-personas")
        result = await c.contribute(session, ctx)
        assert result.values == {}
        assert result.pod_spec is None


# ---------------------------------------------------------------------------
# Contributor output — 2 personas
# ---------------------------------------------------------------------------


class TestContributorOutput:
    async def test_two_ravn_containers_produced(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        assert result.pod_spec is not None
        assert len(result.pod_spec.extra_containers) == 2

    async def test_ravn_container_names(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        names = [ctr["name"] for ctr in result.pod_spec.extra_containers]
        assert "ravn-coordinator" in names
        assert "ravn-reviewer" in names

    async def test_skuld_mesh_enabled_in_env(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        env_names = {e["name"]: e["value"] for e in result.pod_spec.env}
        assert env_names.get("MESH_ENABLED") == "true"
        assert "MESH_PEER_ID" in env_names
        assert "MESH_PUB_ADDRESS" in env_names
        assert "MESH_REP_ADDRESS" in env_names

    async def test_mimir_volume_added(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        volume_names = [v["name"] for v in result.pod_spec.volumes]
        assert "mimir-local" in volume_names

    async def test_ravn_container_has_mimir_mount(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        ravn_ctr = result.pod_spec.extra_containers[0]
        mount_paths = {m["mountPath"] for m in ravn_ctr["volumeMounts"]}
        assert "/mimir/local" in mount_paths

    async def test_ravn_container_has_workspace_mount(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        ravn_ctr = result.pod_spec.extra_containers[0]
        mount_paths = {m["mountPath"] for m in ravn_ctr["volumeMounts"]}
        assert "/workspace" in mount_paths

    async def test_ravn_container_workspace_readonly(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        ravn_ctr = result.pod_spec.extra_containers[0]
        ws_mount = next(m for m in ravn_ctr["volumeMounts"] if m["mountPath"] == "/workspace")
        assert ws_mount.get("readOnly") is True

    async def test_sleipnir_publish_urls_in_skuld_env(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        env_names = {e["name"]: e["value"] for e in result.pod_spec.env}
        assert "SLEIPNIR_PUBLISH_URLS" in env_names
        assert "tyr:8080" in env_names["SLEIPNIR_PUBLISH_URLS"]

    async def test_sleipnir_publish_urls_in_ravn_env(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            assert "SLEIPNIR_PUBLISH_URLS" in env

    async def test_mimir_hosted_url_in_values(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        assert (
            result.values.get("mimir", {}).get("hostedUrl") == "https://mimir.niuu.internal/api/v1"
        )

    async def test_mesh_values_present(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        assert result.values.get("mesh", {}).get("enabled") is True
        assert result.values["mesh"]["transport"] == "nng"


# ---------------------------------------------------------------------------
# Config generation
# ---------------------------------------------------------------------------


class TestConfigGeneration:
    async def test_ravn_config_inline_has_persona(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            assert "RAVN_PEER_ID" in env
            assert env["RAVN_PEER_ID"].startswith("flock-")

            inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
            persona = env["RAVN_PERSONA"]
            assert persona in inline_cfg

    async def test_ravn_config_has_mesh_section(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
            assert "mesh:" in inline_cfg
            assert "enabled: true" in inline_cfg

    async def test_ravn_config_has_mimir_instances(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
            assert "mimir:" in inline_cfg
            assert "instances:" in inline_cfg
            assert "/mimir/local" in inline_cfg

    async def test_ravn_config_has_write_routing(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
            assert "write_routing:" in inline_cfg
            # self/ always routes to local
            assert "self/" in inline_cfg

    async def test_ravn_config_hosted_url_in_instances(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
            # Hosted URL from flock_template is present as a mimir instance
            assert "https://mimir.niuu.internal/api/v1" in inline_cfg
            # Hosted instance routes project/ and entity/ pages
            assert "project/" in inline_cfg
            assert "entity/" in inline_cfg

    async def test_ravn_config_no_hosted_url_only_local(self, session, flock_profile):
        """When no hosted URL configured, config only has local mimir instance."""
        provider = MagicMock()
        provider.get.return_value = flock_profile  # flock_profile has mimir: {}
        c = RavnFlockContributor(profile_provider=provider)
        ctx = SessionContext(profile_name="ravn-flock")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
            assert "/mimir/local" in inline_cfg
            # No hosted instance — project/ and entity/ prefixes absent
            assert "project/" not in inline_cfg
            assert "entity/" not in inline_cfg

    async def test_ravn_config_sleipnir_webhook(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
            assert "sleipnir:" in inline_cfg
            assert "webhook" in inline_cfg


# ---------------------------------------------------------------------------
# NNG port allocation
# ---------------------------------------------------------------------------


class TestNngPortAllocation:
    async def test_ravn_containers_have_nng_ports(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            port_nums = {p["containerPort"] for p in ctr["ports"]}
            # Each ravn container must have pub, rep, hs, gw ports
            assert len(port_nums) == 4

    async def test_skuld_and_ravn_ports_do_not_collide(self, session, flock_template):
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        all_ports: list[int] = []
        # Skuld ports from env
        skuld_env = {e["name"]: e["value"] for e in result.pod_spec.env}
        for key in ("MESH_PUB_ADDRESS", "MESH_REP_ADDRESS"):
            addr = skuld_env.get(key, "")
            port = int(addr.rsplit(":", 1)[-1])
            all_ports.append(port)

        # Ravn container ports
        for ctr in result.pod_spec.extra_containers:
            for p in ctr["ports"]:
                all_ports.append(p["containerPort"])

        assert len(all_ports) == len(set(all_ports)), "Port collision detected"


# ---------------------------------------------------------------------------
# Integration: contributor pipeline merge
# ---------------------------------------------------------------------------


class TestContributorPipelineMerge:
    async def test_merge_with_core_contributor(self, session, flock_template):
        template_provider = MagicMock()
        template_provider.get.return_value = flock_template

        core = CoreSessionContributor(base_domain="example.com")
        flock = RavnFlockContributor(template_provider=template_provider)

        ctx = SessionContext(template_name="ravn-flock")
        contributions = [
            await core.contribute(session, ctx),
            await flock.contribute(session, ctx),
        ]

        spec = SessionSpec.merge(contributions)

        # Core values present
        assert "session" in spec.values
        assert spec.values["session"]["name"] == "test-flock"

        # Flock values present
        assert "mesh" in spec.values
        assert spec.values["mesh"]["enabled"] is True

        # Ravn containers in pod spec
        assert len(spec.pod_spec.extra_containers) == 2

        # Mimir volume present
        volume_names = [v["name"] for v in spec.pod_spec.volumes]
        assert "mimir-local" in volume_names

    async def test_merge_preserves_skuld_env(self, session, flock_template):
        template_provider = MagicMock()
        template_provider.get.return_value = flock_template

        core = CoreSessionContributor(base_domain="example.com")
        flock = RavnFlockContributor(template_provider=template_provider)

        ctx = SessionContext(template_name="ravn-flock")
        contributions = [
            await core.contribute(session, ctx),
            await flock.contribute(session, ctx),
        ]
        spec = SessionSpec.merge(contributions)

        env_names = {e["name"] for e in spec.pod_spec.env}
        assert "MESH_ENABLED" in env_names
        assert "MESH_PEER_ID" in env_names

    async def test_non_flock_session_no_ravn_containers(self, session, session_template):
        template_provider = MagicMock()
        template_provider.get.return_value = session_template

        core = CoreSessionContributor(base_domain="example.com")
        flock = RavnFlockContributor(template_provider=template_provider)

        ctx = SessionContext(template_name="default")
        contributions = [
            await core.contribute(session, ctx),
            await flock.contribute(session, ctx),
        ]
        spec = SessionSpec.merge(contributions)

        assert spec.pod_spec.extra_containers == ()


# ---------------------------------------------------------------------------
# Profile provider path
# ---------------------------------------------------------------------------


class TestProfileProviderPath:
    async def test_profile_provider_resolves_flock(self, session, flock_profile):
        profile_provider = MagicMock()
        profile_provider.get.return_value = flock_profile
        c = RavnFlockContributor(profile_provider=profile_provider)
        ctx = SessionContext(profile_name="ravn-flock")
        result = await c.contribute(session, ctx)

        assert result.pod_spec is not None
        assert len(result.pod_spec.extra_containers) == 2

    async def test_default_profile_fallback(self, session, flock_profile):
        profile_provider = MagicMock()
        profile_provider.get.return_value = None
        profile_provider.get_default.return_value = flock_profile
        c = RavnFlockContributor(profile_provider=profile_provider)
        ctx = SessionContext(profile_name="nonexistent")
        result = await c.contribute(session, ctx)

        assert result.pod_spec is not None
        assert len(result.pod_spec.extra_containers) == 2

    async def test_template_takes_precedence_over_profile(
        self, session, flock_template, session_template
    ):
        template_provider = MagicMock()
        template_provider.get.return_value = session_template
        profile_provider = MagicMock()
        profile_provider.get.return_value = MagicMock(workload_type="ravn_flock")

        c = RavnFlockContributor(
            template_provider=template_provider,
            profile_provider=profile_provider,
        )
        ctx = SessionContext(template_name="default", profile_name="ravn-flock")
        result = await c.contribute(session, ctx)

        # Template has workload_type='session' — should no-op
        assert result.values == {}
        assert result.pod_spec is None


# ---------------------------------------------------------------------------
# Extra kwargs ignored
# ---------------------------------------------------------------------------


class TestExtraKwargs:
    def test_extra_kwargs_ignored(self):
        c = RavnFlockContributor(
            template_provider=None,
            profile_provider=None,
            storage=None,
            gateway=None,
            unknown_kwarg="ignored",
        )
        assert c.name == "ravn_flock"


# ---------------------------------------------------------------------------
# LLM config passthrough
# ---------------------------------------------------------------------------

_LLM_CONFIG = {
    "model": "Qwen/Qwen3-Coder-30B-A3B-Instruct",
    "max_tokens": 8192,
    "timeout": 300.0,
    "provider": {
        "adapter": "ravn.adapters.llm.openai.OpenAICompatibleAdapter",
        "kwargs": {
            "base_url": "https://vllm.valaskjalf.asgard.niuu.world",
            "api_key": "",
        },
    },
}


@pytest.fixture
def flock_template_with_llm():
    return WorkspaceTemplate(
        name="ravn-flock-llm",
        workload_type="ravn_flock",
        workload_config={
            "personas": ["coordinator", "reviewer"],
            "mesh": {"transport": "nng"},
            "mimir": {},
            "sleipnir": {},
            "llm_config": _LLM_CONFIG,
        },
    )


class TestLLMConfigPassthrough:
    async def test_llm_block_in_ravn_config_when_provided(self, session, flock_template_with_llm):
        provider = MagicMock()
        provider.get.return_value = flock_template_with_llm
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock-llm")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
            assert "llm:" in inline_cfg
            assert "Qwen/Qwen3-Coder-30B-A3B-Instruct" in inline_cfg
            assert "vllm.valaskjalf.asgard.niuu.world" in inline_cfg

    async def test_no_llm_block_when_not_provided(self, session, flock_template):
        """flock_template has no llm_config — no llm: block emitted."""
        provider = MagicMock()
        provider.get.return_value = flock_template
        c = RavnFlockContributor(template_provider=provider)
        ctx = SessionContext(template_name="ravn-flock")
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
            assert "llm:" not in inline_cfg

    async def test_llm_config_from_workload_context(self, session):
        """When workload_type comes directly via SessionContext (SpawnRequest path)."""
        c = RavnFlockContributor()
        ctx = SessionContext(
            workload_type="ravn_flock",
            workload_config={
                "personas": ["coordinator"],
                "llm_config": _LLM_CONFIG,
            },
        )
        result = await c.contribute(session, ctx)

        assert result.pod_spec is not None
        ravn_ctr = result.pod_spec.extra_containers[0]
        env = {e["name"]: e["value"] for e in ravn_ctr["env"]}
        inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
        assert "llm:" in inline_cfg
        assert "Qwen/Qwen3-Coder-30B-A3B-Instruct" in inline_cfg

    async def test_empty_llm_config_dict_not_emitted(self, session):
        """An empty llm_config dict should not produce an llm: block."""
        c = RavnFlockContributor()
        ctx = SessionContext(
            workload_type="ravn_flock",
            workload_config={
                "personas": ["coordinator"],
                "llm_config": {},
            },
        )
        result = await c.contribute(session, ctx)

        ravn_ctr = result.pod_spec.extra_containers[0]
        env = {e["name"]: e["value"] for e in ravn_ctr["env"]}
        inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
        assert "llm:" not in inline_cfg

    async def test_all_nodes_receive_same_llm_config(self, session):
        """All ravn nodes in a flock receive the same llm_config."""
        llm = {"model": "anthropic/claude-sonnet-4-6", "max_tokens": 4096}
        c = RavnFlockContributor()
        ctx = SessionContext(
            workload_type="ravn_flock",
            workload_config={
                "personas": ["coordinator", "reviewer"],
                "llm_config": llm,
            },
        )
        result = await c.contribute(session, ctx)

        for ctr in result.pod_spec.extra_containers:
            env = {e["name"]: e["value"] for e in ctr["env"]}
            inline_cfg = env.get("RAVN_CONFIG_INLINE", "")
            assert "claude-sonnet-4-6" in inline_cfg
