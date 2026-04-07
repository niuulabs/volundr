"""KubernetesJobSpawnAdapter — spawn Ravn instances as Kubernetes Jobs.

Creates a Job per instance using the Ravn container image.  Jobs register
with DiscoveryPort (via Sleipnir announce on startup) and appear in the
verified peer table once the handshake completes.

Used on Valaskjalf and any Kubernetes cluster.  Requires ``kubernetes``
Python client to be installed.
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from ravn.ports.spawn import SpawnConfig

logger = logging.getLogger(__name__)

_DEFAULT_SPAWN_TIMEOUT_S = 120.0
_POLL_INTERVAL_S = 1.0
_DEFAULT_NAMESPACE = "ravn"
_DEFAULT_IMAGE = "ghcr.io/niuulabs/ravn:latest"


class KubernetesJobSpawnAdapter:
    """Spawn ephemeral Ravn instances as Kubernetes Jobs.

    Args:
        discovery:        DiscoveryPort instance for polling peer registration.
        namespace:        Kubernetes namespace for Jobs.
        image:            Container image for spawned Ravens.
        realm_id_env:     Environment variable name that holds the realm ID secret.
        spawn_timeout_s:  Seconds to wait for each peer to register.
        cpu_request:      CPU resource request (e.g. "500m").
        memory_request:   Memory resource request (e.g. "256Mi").
        gpu_count:        Number of GPUs to request (0 = no GPU).
        extra_env:        Additional environment variables for every Job.
    """

    def __init__(
        self,
        discovery: object,
        *,
        namespace: str = _DEFAULT_NAMESPACE,
        image: str = _DEFAULT_IMAGE,
        realm_id_env: str = "RAVN_REALM_ID",
        spawn_timeout_s: float = _DEFAULT_SPAWN_TIMEOUT_S,
        cpu_request: str = "500m",
        memory_request: str = "256Mi",
        gpu_count: int = 0,
        extra_env: dict[str, str] | None = None,
    ) -> None:
        self._discovery = discovery
        self._namespace = namespace
        self._image = image
        self._realm_id_env = realm_id_env
        self._spawn_timeout_s = spawn_timeout_s
        self._cpu_request = cpu_request
        self._memory_request = memory_request
        self._gpu_count = gpu_count
        self._extra_env = extra_env or {}
        # peer_id → job_name
        self._spawned: dict[str, str] = {}

    async def spawn(self, count: int, config: SpawnConfig) -> list[str]:
        """Spawn *count* Ravn Kubernetes Jobs and return their peer_ids.

        Raises ``TimeoutError`` if any instance fails to register.
        """
        peer_ids: list[str] = []
        for _ in range(count):
            peer_id = await self._spawn_one(config)
            peer_ids.append(peer_id)
        return peer_ids

    async def terminate(self, peer_id: str) -> None:
        """Delete the Kubernetes Job for a spawned instance."""
        job_name = self._spawned.pop(peer_id, None)
        if job_name is None:
            logger.warning("k8s_spawn: terminate called for unknown peer %s", peer_id)
            return
        await self._delete_job(job_name)
        logger.info("k8s_spawn: deleted Job %s for peer %s", job_name, peer_id)

    async def terminate_all(self) -> None:
        """Delete all Kubernetes Jobs this spawner created."""
        peer_ids = list(self._spawned)
        for peer_id in peer_ids:
            await self.terminate(peer_id)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _spawn_one(self, config: SpawnConfig) -> str:
        """Create one Job, wait for peer registration, return peer_id."""
        job_name = f"ravn-spawn-{uuid.uuid4().hex[:8]}"
        await self._create_job(job_name, config)
        logger.info("k8s_spawn: created Job %s", job_name)

        try:
            peer_id = await asyncio.wait_for(
                self._wait_for_new_peer(config),
                timeout=self._spawn_timeout_s,
            )
        except TimeoutError:
            await self._delete_job(job_name)
            raise TimeoutError(
                f"Spawned Ravn Job {job_name!r} did not register within {self._spawn_timeout_s}s"
            )

        self._spawned[peer_id] = job_name
        logger.info("k8s_spawn: peer %s registered (job=%s)", peer_id, job_name)
        return peer_id

    async def _wait_for_new_peer(self, config: SpawnConfig) -> str:
        """Poll DiscoveryPort until a new peer with matching persona appears."""
        known: set[str] = set(getattr(self._discovery, "peers", lambda: {})().keys())
        while True:
            await asyncio.sleep(_POLL_INTERVAL_S)
            current: dict = getattr(self._discovery, "peers", lambda: {})()
            new_peers = {pid: p for pid, p in current.items() if pid not in known}
            for pid, peer in new_peers.items():
                if not config.persona or getattr(peer, "persona", "") == config.persona:
                    return pid

    async def _create_job(self, job_name: str, config: SpawnConfig) -> None:
        """Create a Kubernetes Job for a Ravn daemon instance."""
        try:
            from kubernetes import client as k8s_client  # noqa: PLC0415
            from kubernetes import config as k8s_config  # noqa: PLC0415
        except ImportError as exc:
            raise RuntimeError(
                "kubernetes Python client is required for KubernetesJobSpawnAdapter. "
                "Install it with: pip install kubernetes"
            ) from exc

        try:
            k8s_config.load_incluster_config()
        except k8s_config.ConfigException:
            k8s_config.load_kube_config()

        env_vars = [
            k8s_client.V1EnvVar(name="RAVN_INITIATIVE__ENABLED", value="true"),
            k8s_client.V1EnvVar(
                name="RAVN_INITIATIVE__MAX_CONCURRENT_TASKS",
                value=str(config.max_concurrent_tasks),
            ),
            k8s_client.V1EnvVar(name="RAVN_INITIATIVE__DEFAULT_PERSONA", value=config.persona),
            k8s_client.V1EnvVar(name="RAVN_PERMISSION__MODE", value=config.permission_mode),
            # Pass realm secret from the same env var name
            k8s_client.V1EnvVar(
                name=self._realm_id_env,
                value_from=k8s_client.V1EnvVarSource(
                    secret_key_ref=k8s_client.V1SecretKeySelector(
                        name="ravn-realm",
                        key="realm_id",
                        optional=True,
                    )
                ),
            ),
        ]
        for key, val in {**self._extra_env, **config.env}.items():
            env_vars.append(k8s_client.V1EnvVar(name=key, value=val))

        resources_dict: dict = {
            "requests": {"cpu": self._cpu_request, "memory": self._memory_request},
            "limits": {"cpu": self._cpu_request, "memory": self._memory_request},
        }
        if self._gpu_count > 0:
            resources_dict["limits"]["nvidia.com/gpu"] = str(self._gpu_count)
            resources_dict["requests"]["nvidia.com/gpu"] = str(self._gpu_count)

        job_body = k8s_client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=k8s_client.V1ObjectMeta(
                name=job_name,
                namespace=self._namespace,
                labels={"app": "ravn", "spawned-by": "cascade"},
            ),
            spec=k8s_client.V1JobSpec(
                ttl_seconds_after_finished=300,
                backoff_limit=0,
                template=k8s_client.V1PodTemplateSpec(
                    metadata=k8s_client.V1ObjectMeta(
                        labels={"app": "ravn", "job-name": job_name}
                    ),
                    spec=k8s_client.V1PodSpec(
                        restart_policy="Never",
                        containers=[
                            k8s_client.V1Container(
                                name="ravn",
                                image=self._image,
                                command=["ravn", "daemon"],
                                env=env_vars,
                                resources=k8s_client.V1ResourceRequirements(**resources_dict),
                            )
                        ],
                    ),
                ),
            ),
        )

        batch_v1 = k8s_client.BatchV1Api()
        # Run blocking k8s call in executor to not block event loop
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: batch_v1.create_namespaced_job(self._namespace, job_body),
        )

    async def _delete_job(self, job_name: str) -> None:
        """Delete a Kubernetes Job and its pods."""
        try:
            from kubernetes import client as k8s_client  # noqa: PLC0415
            from kubernetes import config as k8s_config  # noqa: PLC0415
        except ImportError:
            logger.warning("k8s_spawn: kubernetes client not available — skip delete %s", job_name)
            return

        try:
            k8s_config.load_incluster_config()
        except k8s_config.ConfigException:
            k8s_config.load_kube_config()

        batch_v1 = k8s_client.BatchV1Api()
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(
                None,
                lambda: batch_v1.delete_namespaced_job(
                    job_name,
                    self._namespace,
                    body=k8s_client.V1DeleteOptions(propagation_policy="Foreground"),
                ),
            )
        except Exception as exc:
            logger.warning("k8s_spawn: failed to delete Job %s: %s", job_name, exc)
