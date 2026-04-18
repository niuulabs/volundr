"""RavnFlockContributor — pod spec builder for raiding party (flock) pods.

When workload_type == "ravn_flock", this contributor replaces the default
single-CLI layout with:
  - Skuld container with mesh.enabled=true + nng ports + Sleipnir webhook
  - N ravn daemon sidecar containers (one per persona in workload_config.personas)
  - Per-sidecar initContainer that writes YAML config to an emptyDir volume
    mounted read-only at /etc/ravn/config.yaml (RAVN_CONFIG env var points here)
  - nng mesh ports allocated via the same scheme as ravn flock init
  - Mimir emptyDir volume for ephemeral local memory
  - Sleipnir webhook transport config in both skuld and ravn containers

Port allocation (mirrors ravn/cli/flock.py via niuu.mesh):
  pub       = base_port + index * 2
  rep       = base_port + index * 2 + 1
  handshake = base_port + 100 + index
  gateway   = base_port + 200 + index
"""

from __future__ import annotations

import logging
from typing import Any

import yaml

from niuu.domain.llm_merge import _SECURITY_KEYS, merge_llm
from niuu.mesh import nng_gateway_port_for as _gateway_port_for
from niuu.mesh import nng_ports_for as _ports_for
from volundr.domain.models import ForgeProfile, PodSpecAdditions, Session, WorkspaceTemplate
from volundr.domain.ports import (
    ProfileProvider,
    SessionContext,
    SessionContribution,
    SessionContributor,
    TemplateProvider,
)

logger = logging.getLogger(__name__)

_DEFAULT_BASE_PORT = 7480
_DEFAULT_MAX_CONCURRENT_TASKS = 3
_MIMIR_VOLUME_NAME = "mimir-local"
_MIMIR_MOUNT_PATH = "/mimir/local"
_WORKSPACE_VOLUME_NAME = "workspace"
_WORKSPACE_MOUNT_PATH = "/workspace"
_RAVN_IMAGE_DEFAULT = "ghcr.io/niuulabs/ravn:latest"
_RAVN_CONFIG_MOUNT_PATH = "/etc/ravn/config.yaml"
_RAVN_CONFIG_VOLUME_PREFIX = "ravn-cfg"
_RAVN_CONFIG_DIR = "/etc/ravn"
_INIT_WRITER_IMAGE = "busybox:latest"


def _normalize_personas(raw: list) -> list[dict]:
    """Normalize personas to list[dict].

    Accepts both legacy ``list[str]`` and new ``list[dict]`` with per-persona
    overrides.  Mixed lists (some strings, some dicts) are also supported.

    Security keys (``allowed_tools``, ``forbidden_tools``) are stripped with
    a WARN log — they are not overridable at the workload_config layer.
    """
    result: list[dict] = []
    for entry in raw:
        if isinstance(entry, str):
            result.append({"name": entry})
            continue

        if not isinstance(entry, dict):
            logger.warning("ravn_flock: skipping non-str/dict persona entry: %r", entry)
            continue

        if "name" not in entry:
            logger.warning("ravn_flock: skipping persona dict without 'name': %r", entry)
            continue

        cleaned = dict(entry)
        for security_key in _SECURITY_KEYS:
            if security_key in cleaned:
                logger.warning(
                    "ravn_flock: dropping security key %r from persona %r — "
                    "not overridable at the workload_config layer",
                    security_key,
                    cleaned["name"],
                )
                del cleaned[security_key]
        result.append(cleaned)
    return result


def _build_ravn_config(
    *,
    persona: str,
    persona_override: dict,
    global_llm: dict | None,
    index: int,
    peer_id: str,
    base_port: int,
    all_personas: list[str],
    skuld_peer_id: str,
    mimir_hosted_url: str | None,
    sleipnir_publish_urls: list[str],
    global_max_concurrent_tasks: int = _DEFAULT_MAX_CONCURRENT_TASKS,
    mesh_host: str = "0.0.0.0",
) -> str:
    """Generate the ravn daemon YAML config for a single flock node.

    Per-persona overrides from *persona_override* are merged on top of
    *global_llm* via :func:`niuu.domain.llm_merge.merge_llm`.  The resulting
    effective LLM config, system_prompt_extra, and iteration_budget are all
    embedded in the sidecar YAML so that ravn can apply them at runtime.
    """
    pub, rep, _hs = _ports_for(index, base_port)
    gw = _gateway_port_for(index, base_port)

    peers: list[dict[str, str]] = [{"peer_id": skuld_peer_id}] + [
        {"peer_id": f"flock-{p}"} for p in all_personas if p != persona
    ]

    mimir_instances: list[dict[str, Any]] = [
        {"name": "local", "role": "local", "path": _MIMIR_MOUNT_PATH},
    ]
    mimir_write_rules: list[dict[str, Any]] = [
        {"prefix": "self/", "mounts": ["local"]},
    ]
    if mimir_hosted_url:
        mimir_instances.append(
            {
                "name": "hosted",
                "role": "shared",
                "url": mimir_hosted_url,
                "categories": ["entity", "decision", "directive", "topic"],
            }
        )
        mimir_write_rules.extend(
            [
                {"prefix": "project/", "mounts": ["hosted"]},
                {"prefix": "entity/", "mounts": ["hosted"]},
            ]
        )

    max_tasks = persona_override.get("max_concurrent_tasks") or global_max_concurrent_tasks

    config: dict[str, Any] = {
        "persona": persona,
        "mesh": {
            "enabled": True,
            "adapter": "nng",
            "own_peer_id": peer_id,
            "nng": {
                "pub_sub_address": f"tcp://{mesh_host}:{pub}",
                "req_rep_address": f"tcp://{mesh_host}:{rep}",
            },
            "peers": peers,
        },
        "discovery": {"enabled": True, "adapter": "static"},
        "cascade": {"enabled": True},
        "gateway": {
            "enabled": True,
            "channels": {
                "http": {"enabled": True, "host": "0.0.0.0", "port": gw},
            },
        },
        "initiative": {
            "enabled": True,
            "max_concurrent_tasks": max_tasks,
        },
        "mimir": {
            "enabled": True,
            "instances": mimir_instances,
            "write_routing": {
                "rules": mimir_write_rules,
                "default": ["local"],
            },
        },
        "logging": {"level": "INFO"},
    }

    # Merge LLM config: global override → per-persona override (last wins).
    effective_llm = merge_llm(
        defaults=None,
        global_override=global_llm,
        persona_override=persona_override.get("llm"),
    )
    if effective_llm:
        config["llm"] = effective_llm

    # Per-persona behavioral overrides — applied by ravn at persona load time.
    # Both system_prompt_extra and iteration_budget must land in persona_overrides
    # so that PersonaOverridesConfig (ravn/config.py) picks them up via pydantic.
    # iteration_budget is also mirrored to initiative for future initiative-level use.
    po: dict = {}
    system_prompt_extra = persona_override.get("system_prompt_extra") or ""
    if system_prompt_extra.strip():
        po["system_prompt_extra"] = system_prompt_extra
    budget = persona_override.get("iteration_budget") or 0
    if budget:
        po["iteration_budget"] = int(budget)
        config["initiative"]["iteration_budget"] = int(budget)
    if po:
        config["persona_overrides"] = po

    if sleipnir_publish_urls:
        config["sleipnir"] = {
            "enabled": True,
            "transport": "webhook",
            "webhook": {"publish_urls": sleipnir_publish_urls},
        }

    return yaml.safe_dump(config, default_flow_style=False, sort_keys=False)


class RavnFlockContributor(SessionContributor):
    """Contributes flock pod spec when workload_type == 'ravn_flock'.

    Resolves the profile or template from the session context, reads
    workload_config.personas + mesh/mimir/sleipnir settings, then:
      - Emits skuld mesh env vars (MESH_ENABLED, MESH_PEER_ID, nng addresses)
      - Emits one ravn sidecar container per persona with RAVN_CONFIG env
      - Emits per-sidecar initContainer + emptyDir volume for mounted config
      - Emits a Mimir emptyDir volume
      - Emits Sleipnir webhook env vars for both skuld and ravn containers

    No-ops silently when workload_type != 'ravn_flock'.
    """

    def __init__(
        self,
        *,
        template_provider: TemplateProvider | None = None,
        profile_provider: ProfileProvider | None = None,
        ravn_image: str = _RAVN_IMAGE_DEFAULT,
        base_port: int = _DEFAULT_BASE_PORT,
        mesh_host: str = "0.0.0.0",
        **_extra: object,
    ) -> None:
        self._template_provider = template_provider
        self._profile_provider = profile_provider
        self._ravn_image = ravn_image
        self._base_port = base_port
        self._mesh_host = mesh_host

    @property
    def name(self) -> str:
        return "ravn_flock"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        # Check context first (workload_type from SpawnRequest / REST body)
        if context.workload_type == "ravn_flock" and context.workload_config:
            wc = context.workload_config
        else:
            # Fall back to template/profile resolution
            source = self._resolve_source(context)
            if source is None or source.workload_type != "ravn_flock":
                return SessionContribution()
            wc = source.workload_config
        raw_personas: list = list(wc.get("personas", []))

        if not raw_personas:
            logger.warning(
                "ravn_flock workload_config has no personas — skipping flock contribution"
            )
            return SessionContribution()

        # Normalize personas to list[dict] — accept both legacy list[str]
        # and new list[dict] with per-persona overrides.
        persona_dicts: list[dict] = _normalize_personas(raw_personas)

        mesh_cfg: dict = wc.get("mesh", {})
        mimir_cfg: dict = wc.get("mimir", {})
        sleipnir_cfg: dict = wc.get("sleipnir", {})

        mimir_hosted_url: str | None = mimir_cfg.get("hosted_url")
        sleipnir_publish_urls: list[str] = sleipnir_cfg.get("publish_urls", [])
        mesh_transport: str = mesh_cfg.get("transport", "nng")
        global_max_concurrent_tasks: int = wc.get(
            "max_concurrent_tasks", _DEFAULT_MAX_CONCURRENT_TASKS
        )
        global_llm: dict | None = wc.get("llm_config") or None

        values, pod_spec = self._build_flock_spec(
            session=session,
            persona_dicts=persona_dicts,
            mesh_transport=mesh_transport,
            mimir_hosted_url=mimir_hosted_url,
            sleipnir_publish_urls=sleipnir_publish_urls,
            global_max_concurrent_tasks=global_max_concurrent_tasks,
            global_llm=global_llm,
        )

        return SessionContribution(values=values, pod_spec=pod_spec)

    def _resolve_source(self, context: SessionContext) -> WorkspaceTemplate | ForgeProfile | None:
        if context.template_name and self._template_provider is not None:
            template = self._template_provider.get(context.template_name)
            if template is not None:
                return template

        if self._profile_provider is not None:
            if context.profile_name:
                profile = self._profile_provider.get(context.profile_name)
                if profile is not None:
                    return profile
            default = self._profile_provider.get_default("ravn_flock")
            if default is not None:
                return default

        return None

    def _build_flock_spec(
        self,
        session: Session,
        persona_dicts: list[dict],
        mesh_transport: str,
        mimir_hosted_url: str | None,
        sleipnir_publish_urls: list[str],
        global_max_concurrent_tasks: int,
        global_llm: dict | None = None,
    ) -> tuple[dict[str, Any], PodSpecAdditions]:
        session_id = str(session.id)
        base_port = self._base_port
        all_personas = [pd["name"] for pd in persona_dicts]

        # Skuld (index 0) + ravn nodes start at index 1
        skuld_peer_id = f"skuld-{session_id[:8]}"
        skuld_pub, skuld_rep, skuld_hs = _ports_for(0, base_port)

        skuld_env: list[dict] = [
            {"name": "MESH_ENABLED", "value": "true"},
            {"name": "MESH_TRANSPORT", "value": mesh_transport},
            {"name": "MESH_PEER_ID", "value": skuld_peer_id},
            {"name": "MESH_PUB_ADDRESS", "value": f"tcp://{self._mesh_host}:{skuld_pub}"},
            {"name": "MESH_REP_ADDRESS", "value": f"tcp://{self._mesh_host}:{skuld_rep}"},
            {"name": "MESH_HANDSHAKE_PORT", "value": str(skuld_hs)},
        ]

        if sleipnir_publish_urls:
            skuld_env.append(
                {
                    "name": "SLEIPNIR_PUBLISH_URLS",
                    "value": ",".join(sleipnir_publish_urls),
                }
            )

        # nng ports for skuld as Helm values
        skuld_ports: list[dict] = [
            {"containerPort": skuld_pub, "name": "mesh-pub", "protocol": "TCP"},
            {"containerPort": skuld_rep, "name": "mesh-rep", "protocol": "TCP"},
            {"containerPort": skuld_hs, "name": "mesh-hs", "protocol": "TCP"},
        ]

        # Ravn sidecar containers (indices 1..N)
        extra_containers: list[dict] = []
        config_volumes: list[dict] = []
        init_containers: list[dict] = []

        for i, persona_dict in enumerate(persona_dicts):
            persona = persona_dict["name"]
            ravn_index = i + 1
            peer_id = f"flock-{persona}"
            pub, rep, hs = _ports_for(ravn_index, base_port)
            gw = _gateway_port_for(ravn_index, base_port)

            config_yaml = _build_ravn_config(
                persona=persona,
                persona_override=persona_dict,
                global_llm=global_llm,
                index=ravn_index,
                peer_id=peer_id,
                base_port=base_port,
                all_personas=all_personas,
                skuld_peer_id=skuld_peer_id,
                mimir_hosted_url=mimir_hosted_url,
                sleipnir_publish_urls=sleipnir_publish_urls,
                global_max_concurrent_tasks=global_max_concurrent_tasks,
                mesh_host=self._mesh_host,
            )

            # Per-sidecar emptyDir volume for the mounted config file
            cfg_vol_name = f"{_RAVN_CONFIG_VOLUME_PREFIX}-{persona}"
            config_volumes.append({"name": cfg_vol_name, "emptyDir": {}})

            # Init container writes YAML into the volume
            heredoc = (
                f"cat > {_RAVN_CONFIG_MOUNT_PATH} <<'__RAVN_EOF__'\n{config_yaml}__RAVN_EOF__\n"
            )
            init_containers.append(
                {
                    "name": f"write-ravn-cfg-{persona}",
                    "image": _INIT_WRITER_IMAGE,
                    "command": ["sh", "-c", heredoc],
                    "volumeMounts": [
                        {"name": cfg_vol_name, "mountPath": _RAVN_CONFIG_DIR},
                    ],
                }
            )

            ravn_env: list[dict] = [
                {"name": "RAVN_PERSONA", "value": persona},
                {"name": "RAVN_PEER_ID", "value": peer_id},
                {"name": "RAVN_CONFIG", "value": _RAVN_CONFIG_MOUNT_PATH},
            ]

            if sleipnir_publish_urls:
                ravn_env.append(
                    {
                        "name": "SLEIPNIR_PUBLISH_URLS",
                        "value": ",".join(sleipnir_publish_urls),
                    }
                )

            container: dict[str, Any] = {
                "name": f"ravn-{persona}",
                "image": self._ravn_image,
                "env": ravn_env,
                "ports": [
                    {"containerPort": pub, "name": f"r{ravn_index}-pub", "protocol": "TCP"},
                    {"containerPort": rep, "name": f"r{ravn_index}-rep", "protocol": "TCP"},
                    {"containerPort": hs, "name": f"r{ravn_index}-hs", "protocol": "TCP"},
                    {"containerPort": gw, "name": f"r{ravn_index}-gw", "protocol": "TCP"},
                ],
                "volumeMounts": [
                    {"name": _MIMIR_VOLUME_NAME, "mountPath": _MIMIR_MOUNT_PATH},
                    {
                        "name": _WORKSPACE_VOLUME_NAME,
                        "mountPath": _WORKSPACE_MOUNT_PATH,
                        "readOnly": True,
                    },
                    {
                        "name": cfg_vol_name,
                        "mountPath": _RAVN_CONFIG_DIR,
                        "readOnly": True,
                    },
                ],
            }
            extra_containers.append(container)

        pod_spec = PodSpecAdditions(
            volumes=(
                {"name": _MIMIR_VOLUME_NAME, "emptyDir": {}},
                *config_volumes,
            ),
            env=tuple(skuld_env),
            extra_containers=tuple(extra_containers),
            init_containers=tuple(init_containers),
        )

        values: dict[str, Any] = {
            "mesh": {
                "enabled": True,
                "transport": mesh_transport,
                "peerPorts": skuld_ports,
            },
        }

        if mimir_hosted_url:
            values["mimir"] = {"hostedUrl": mimir_hosted_url}

        if sleipnir_publish_urls:
            values["sleipnir"] = {"publishUrls": sleipnir_publish_urls}

        logger.info(
            "ravn_flock: session=%s skuld peer=%s ravn personas=%s base_port=%d",
            session_id[:8],
            skuld_peer_id,
            all_personas,
            base_port,
        )

        return values, pod_spec
