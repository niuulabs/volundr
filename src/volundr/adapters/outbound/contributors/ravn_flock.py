"""RavnFlockContributor — pod spec builder for raiding party (flock) pods.

When workload_type == "ravn_flock", this contributor replaces the default
single-CLI layout with:
  - Skuld container with mesh.enabled=true + nng ports + Sleipnir webhook
  - N ravn daemon sidecar containers (one per persona in workload_config.personas)
  - nng mesh ports allocated via the same scheme as ravn flock init
  - Mimir emptyDir volume for ephemeral local memory
  - Sleipnir webhook transport config in both skuld and ravn containers

Port allocation (mirrors ravn/cli/flock.py):
  pub       = base_port + index * 2
  rep       = base_port + index * 2 + 1
  handshake = base_port + 100 + index
  gateway   = base_port + 200 + index
"""

from __future__ import annotations

import logging
from typing import Any

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
_MIMIR_VOLUME_NAME = "mimir-local"
_MIMIR_MOUNT_PATH = "/mimir/local"
_WORKSPACE_VOLUME_NAME = "workspace"
_WORKSPACE_MOUNT_PATH = "/workspace"
_RAVN_IMAGE_DEFAULT = "ghcr.io/niuulabs/ravn:latest"


def _ports_for(index: int, base_port: int) -> tuple[int, int, int]:
    """Return (pub_port, rep_port, handshake_port) for the node at *index*."""
    pub = base_port + (index * 2)
    rep = base_port + (index * 2) + 1
    hs = base_port + 100 + index
    return pub, rep, hs


def _gateway_port_for(index: int, base_port: int) -> int:
    """Return the HTTP/WS gateway port for the node at *index*."""
    return base_port + 200 + index


def _build_ravn_config(
    index: int,
    persona: str,
    peer_id: str,
    base_port: int,
    all_personas: list[str],
    mimir_hosted_url: str | None,
    sleipnir_publish_urls: list[str],
) -> str:
    """Generate the ravn daemon YAML config for a single flock node."""
    pub, rep, hs = _ports_for(index, base_port)
    gw = _gateway_port_for(index, base_port)

    peers_block = "\n".join(f'    - peer_id: "flock-{p}"' for p in all_personas if p != persona)

    mimir_block = (
        "memory:\n"
        "  backend: composite\n"
        "  composite:\n"
        "    backends:\n"
        "      - type: local\n"
        "        path: /mimir/local"
    )
    if mimir_hosted_url:
        mimir_block += f"\n      - type: hosted\n        url: {mimir_hosted_url!r}"

    sleipnir_urls = "\n".join(f'      - "{u}"' for u in sleipnir_publish_urls)
    sleipnir_block = ""
    if sleipnir_publish_urls:
        sleipnir_block = (
            "sleipnir:\n"
            "  enabled: true\n"
            "  transport: webhook\n"
            "  webhook:\n"
            "    publish_urls:\n"
            f"{sleipnir_urls}\n"
        )

    peers_section = ""
    if peers_block:
        peers_section = f"  peers:\n{peers_block}\n"

    return (
        f"persona: {persona!r}\n"
        f"\n"
        f"mesh:\n"
        f"  enabled: true\n"
        f"  adapter: nng\n"
        f'  own_peer_id: "{peer_id}"\n'
        f"  nng:\n"
        f'    pub_sub_address: "tcp://0.0.0.0:{pub}"\n'
        f'    req_rep_address: "tcp://0.0.0.0:{rep}"\n'
        f"{peers_section}"
        f"\n"
        f"discovery:\n"
        f"  enabled: true\n"
        f"  adapter: static\n"
        f"\n"
        f"cascade:\n"
        f"  enabled: true\n"
        f"\n"
        f"gateway:\n"
        f"  enabled: true\n"
        f"  channels:\n"
        f"    http:\n"
        f"      enabled: true\n"
        f"      host: '0.0.0.0'\n"
        f"      port: {gw}\n"
        f"\n"
        f"initiative:\n"
        f"  enabled: true\n"
        f"  max_concurrent_tasks: 3\n"
        f"\n"
        f"{mimir_block}\n"
        f"\n"
        f"{sleipnir_block}"
        f"logging:\n"
        f"  level: INFO\n"
    )


class RavnFlockContributor(SessionContributor):
    """Contributes flock pod spec when workload_type == 'ravn_flock'.

    Resolves the profile or template from the session context, reads
    workload_config.personas + mesh/mimir/sleipnir settings, then:
      - Emits skuld mesh env vars (MESH_ENABLED, MESH_PEER_ID, nng addresses)
      - Emits one ravn sidecar container per persona with RAVN_CONFIG env
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
        **_extra: object,
    ) -> None:
        self._template_provider = template_provider
        self._profile_provider = profile_provider
        self._ravn_image = ravn_image
        self._base_port = base_port

    @property
    def name(self) -> str:
        return "ravn_flock"

    async def contribute(
        self,
        session: Session,
        context: SessionContext,
    ) -> SessionContribution:
        source = self._resolve_source(context)

        if source is None:
            return SessionContribution()

        if source.workload_type != "ravn_flock":
            return SessionContribution()

        wc = source.workload_config
        personas: list[str] = list(wc.get("personas", []))

        if not personas:
            logger.warning(
                "ravn_flock workload_config has no personas — skipping flock contribution"
            )
            return SessionContribution()

        mesh_cfg: dict = wc.get("mesh", {})
        mimir_cfg: dict = wc.get("mimir", {})
        sleipnir_cfg: dict = wc.get("sleipnir", {})

        mimir_hosted_url: str | None = mimir_cfg.get("hosted_url")
        sleipnir_publish_urls: list[str] = sleipnir_cfg.get("publish_urls", [])
        mesh_transport: str = mesh_cfg.get("transport", "nng")

        values, pod_spec = self._build_flock_spec(
            session=session,
            personas=personas,
            mesh_transport=mesh_transport,
            mimir_hosted_url=mimir_hosted_url,
            sleipnir_publish_urls=sleipnir_publish_urls,
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
        personas: list[str],
        mesh_transport: str,
        mimir_hosted_url: str | None,
        sleipnir_publish_urls: list[str],
    ) -> tuple[dict[str, Any], PodSpecAdditions]:
        session_id = str(session.id)
        base_port = self._base_port

        # Skuld (index 0) + ravn nodes start at index 1
        skuld_peer_id = f"skuld-{session_id[:8]}"
        skuld_pub, skuld_rep, skuld_hs = _ports_for(0, base_port)

        skuld_env: list[dict] = [
            {"name": "MESH_ENABLED", "value": "true"},
            {"name": "MESH_TRANSPORT", "value": mesh_transport},
            {"name": "MESH_PEER_ID", "value": skuld_peer_id},
            {"name": "MESH_PUB_ADDRESS", "value": f"tcp://0.0.0.0:{skuld_pub}"},
            {"name": "MESH_REP_ADDRESS", "value": f"tcp://0.0.0.0:{skuld_rep}"},
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
        for i, persona in enumerate(personas):
            ravn_index = i + 1
            peer_id = f"flock-{persona}"
            pub, rep, hs = _ports_for(ravn_index, base_port)
            gw = _gateway_port_for(ravn_index, base_port)

            config_yaml = _build_ravn_config(
                index=ravn_index,
                persona=persona,
                peer_id=peer_id,
                base_port=base_port,
                all_personas=personas,
                mimir_hosted_url=mimir_hosted_url,
                sleipnir_publish_urls=sleipnir_publish_urls,
            )

            ravn_env: list[dict] = [
                {"name": "RAVN_PERSONA", "value": persona},
                {"name": "RAVN_PEER_ID", "value": peer_id},
                {"name": "RAVN_CONFIG_INLINE", "value": config_yaml},
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
                ],
            }
            extra_containers.append(container)

        pod_spec = PodSpecAdditions(
            volumes=(
                {
                    "name": _MIMIR_VOLUME_NAME,
                    "emptyDir": {},
                },
            ),
            env=tuple(skuld_env),
            extra_containers=tuple(extra_containers),
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
            personas,
            base_port,
        )

        return values, pod_spec
