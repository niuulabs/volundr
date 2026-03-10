"""Direct Kubernetes API adapter for pod management.

Creates Deployment + Service + Ingress resources directly via the
kubernetes-asyncio Python client. Designed for local k3s/k3d development
where Flux is not available.

Constructor accepts plain kwargs (dynamic adapter pattern):
    adapter: "volundr.adapters.outbound.direct_k8s_pod_manager.DirectK8sPodManager"
    namespace: "volundr"
    kubeconfig: "~/.kube/config"
    base_path: "/s"
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from volundr.domain.models import Session, SessionSpec, SessionStatus
from volundr.domain.ports import CredentialStorePort, PodManager, PodStartResult

logger = logging.getLogger(__name__)

# Label applied to all resources managed by this adapter
MANAGED_BY_LABEL = "app.kubernetes.io/managed-by"
MANAGED_BY_VALUE = "volundr"
SESSION_LABEL = "volundr.niuu.io/session"

# Traefik strip-prefix middleware annotation key
TRAEFIK_STRIP_PREFIX_ANNOTATION = "traefik.ingress.kubernetes.io/router.middlewares"

# Service port for the session pod (nginx entry point)
SESSION_SERVICE_PORT = 8080

# Default poll interval for readiness checks in seconds
DEFAULT_POLL_INTERVAL = 2.0

# Default timeout for readiness checks in seconds
DEFAULT_READINESS_TIMEOUT = 300.0


class DirectK8sPodManager(PodManager):
    """Direct Kubernetes API implementation of PodManager.

    Creates Deployment + Service + Ingress resources for each session
    using path-based routing without a host field. Suitable for local
    k3s/k3d development where only an IP (no DNS) is available.

    Constructor accepts plain kwargs (dynamic adapter pattern).
    """

    def __init__(
        self,
        *,
        namespace: str = "volundr",
        kubeconfig: str = "",
        base_path: str = "/s",
        ingress_class: str = "traefik",
        skuld_image: str = "ghcr.io/niuulabs/skuld:latest",
        code_server_image: str = "codercom/code-server:latest",
        nginx_image: str = "nginx:alpine",
        devrunner_image: str = "ghcr.io/niuulabs/devrunner:latest",
        db_host: str = "host.k3d.internal",
        db_port: int = 5433,
        db_user: str = "volundr",
        db_password: str = "",
        db_name: str = "volundr",
        poll_interval: float = DEFAULT_POLL_INTERVAL,
        readiness_timeout: float = DEFAULT_READINESS_TIMEOUT,
        **_extra: object,
    ):
        self._namespace = namespace
        self._kubeconfig = kubeconfig
        self._base_path = base_path
        self._ingress_class = ingress_class
        self._skuld_image = skuld_image
        self._code_server_image = code_server_image
        self._nginx_image = nginx_image
        self._devrunner_image = devrunner_image
        self._db_host = db_host
        self._db_port = db_port
        self._db_user = db_user
        self._db_password = db_password
        self._db_name = db_name
        self._poll_interval = poll_interval
        self._readiness_timeout = readiness_timeout
        self._credential_store: CredentialStorePort | None = None
        self._api_client = None

    def set_credential_store(self, store: CredentialStorePort) -> None:
        """Inject credential store for resolving envSecrets."""
        self._credential_store = store

    async def _ensure_client(self) -> None:
        """Lazy-load kubernetes-asyncio API client."""
        if self._api_client is not None:
            return

        from kubernetes_asyncio import client, config

        if self._kubeconfig:
            await config.load_kube_config(config_file=self._kubeconfig)
        else:
            try:
                config.load_incluster_config()
            except config.ConfigException:
                await config.load_kube_config()

        self._api_client = client.ApiClient()

    def _release_name(self, session: Session) -> str:
        """Generate the Kubernetes resource name for a session."""
        return f"skuld-{session.id}"

    def _session_path(self, session: Session) -> str:
        """Generate the ingress path for a session."""
        return f"{self._base_path}/{session.id}"

    def _middleware_name(self, session: Session) -> str:
        """Generate the Traefik middleware name for strip-prefix."""
        return f"{self._namespace}-strip-{session.id}"

    def _chat_endpoint(self, session: Session) -> str:
        """Build the chat WebSocket endpoint URL."""
        return f"{self._session_path(session)}/session"

    def _code_endpoint(self, session: Session) -> str:
        """Build the code-server endpoint URL."""
        return f"{self._session_path(session)}/"

    def _build_labels(self, session: Session) -> dict[str, str]:
        """Build standard labels for Kubernetes resources."""
        return {
            MANAGED_BY_LABEL: MANAGED_BY_VALUE,
            SESSION_LABEL: str(session.id),
            "app.kubernetes.io/name": "skuld",
            "app.kubernetes.io/instance": self._release_name(session),
        }

    def _build_env(self, session: Session, spec: SessionSpec) -> list[dict[str, str]]:
        """Build environment variables for the skuld broker container."""
        env: list[dict[str, str]] = [
            {"name": "SESSION_ID", "value": str(session.id)},
            {"name": "SESSION_NAME", "value": session.name},
            {"name": "DATABASE__HOST", "value": self._db_host},
            {"name": "DATABASE__PORT", "value": str(self._db_port)},
            {"name": "DATABASE__USER", "value": self._db_user},
            {"name": "DATABASE__PASSWORD", "value": self._db_password},
            {"name": "DATABASE__NAME", "value": self._db_name},
        ]

        # Handle git config from spec values.
        git_config = spec.values.get("git", {})
        if git_config.get("cloneUrl"):
            env.append({"name": "GIT_CLONE_URL", "value": git_config["cloneUrl"]})
        if git_config.get("branch"):
            env.append({"name": "GIT_BRANCH", "value": git_config["branch"]})

        # Handle session metadata from spec values.
        session_config = spec.values.get("session", {})
        if session_config.get("model"):
            env.append({"name": "SESSION_MODEL", "value": session_config["model"]})

        # Handle extra env passthrough.
        extra_env = spec.values.get("env", {})
        if isinstance(extra_env, dict):
            for k, v in extra_env.items():
                env.append({"name": k, "value": str(v)})

        return env

    def _build_deployment_manifest(
        self, session: Session, spec: SessionSpec,
    ) -> dict[str, Any]:
        """Build a Kubernetes Deployment manifest dict for the session."""
        labels = self._build_labels(session)
        release_name = self._release_name(session)
        env_list = self._build_env(session, spec)

        env_vars = [{"name": e["name"], "value": e["value"]} for e in env_list]

        return {
            "apiVersion": "apps/v1",
            "kind": "Deployment",
            "metadata": {
                "name": release_name,
                "namespace": self._namespace,
                "labels": labels,
            },
            "spec": {
                "replicas": 1,
                "selector": {
                    "matchLabels": {
                        "app.kubernetes.io/instance": release_name,
                    },
                },
                "template": {
                    "metadata": {"labels": labels},
                    "spec": {
                        "terminationGracePeriodSeconds": 30,
                        "containers": [
                            {
                                "name": "nginx",
                                "image": self._nginx_image,
                                "ports": [{"containerPort": SESSION_SERVICE_PORT, "name": "http"}],
                                "resources": {
                                    "requests": {"memory": "32Mi", "cpu": "10m"},
                                    "limits": {"memory": "128Mi", "cpu": "100m"},
                                },
                            },
                            {
                                "name": "skuld",
                                "image": self._skuld_image,
                                "ports": [{"containerPort": 8081, "name": "broker"}],
                                "env": env_vars,
                                "resources": {
                                    "requests": {"memory": "256Mi", "cpu": "100m"},
                                    "limits": {"memory": "1Gi", "cpu": "500m"},
                                },
                            },
                            {
                                "name": "code-server",
                                "image": self._code_server_image,
                                "ports": [{"containerPort": 8443, "name": "ide"}],
                                "resources": {
                                    "requests": {"memory": "256Mi", "cpu": "100m"},
                                    "limits": {"memory": "2Gi", "cpu": "1000m"},
                                },
                            },
                            {
                                "name": "devrunner",
                                "image": self._devrunner_image,
                                "env": [
                                    {"name": "SESSION_ID", "value": str(session.id)},
                                    {"name": "TERMINAL_PORT", "value": "7681"},
                                ],
                                "resources": {
                                    "requests": {"memory": "512Mi", "cpu": "100m"},
                                    "limits": {"memory": "4Gi", "cpu": "2000m"},
                                },
                            },
                        ],
                    },
                },
            },
        }

    def _build_service_manifest(self, session: Session) -> dict[str, Any]:
        """Build a Kubernetes Service manifest dict for the session."""
        labels = self._build_labels(session)
        release_name = self._release_name(session)

        return {
            "apiVersion": "v1",
            "kind": "Service",
            "metadata": {
                "name": release_name,
                "namespace": self._namespace,
                "labels": labels,
            },
            "spec": {
                "type": "ClusterIP",
                "selector": {
                    "app.kubernetes.io/instance": release_name,
                },
                "ports": [
                    {
                        "name": "http",
                        "port": SESSION_SERVICE_PORT,
                        "targetPort": SESSION_SERVICE_PORT,
                    },
                ],
            },
        }

    def _build_ingress_manifest(self, session: Session) -> dict[str, Any]:
        """Build a Kubernetes Ingress manifest with path-based routing.

        Uses Traefik strip-prefix annotation so the path prefix is
        removed before reaching the pod. No host field is set,
        allowing IP-based access.
        """
        labels = self._build_labels(session)
        release_name = self._release_name(session)
        session_path = self._session_path(session)
        middleware_ref = f"{self._namespace}-{release_name}-strip@kubernetescrd"

        return {
            "apiVersion": "networking.k8s.io/v1",
            "kind": "Ingress",
            "metadata": {
                "name": release_name,
                "namespace": self._namespace,
                "labels": labels,
                "annotations": {
                    TRAEFIK_STRIP_PREFIX_ANNOTATION: middleware_ref,
                },
            },
            "spec": {
                "ingressClassName": self._ingress_class,
                "rules": [
                    {
                        "http": {
                            "paths": [
                                {
                                    "path": session_path,
                                    "pathType": "Prefix",
                                    "backend": {
                                        "service": {
                                            "name": release_name,
                                            "port": {"number": SESSION_SERVICE_PORT},
                                        },
                                    },
                                },
                            ],
                        },
                    },
                ],
            },
        }

    def _build_strip_prefix_middleware(self, session: Session) -> dict[str, Any]:
        """Build a Traefik Middleware CR for stripping the session path prefix."""
        release_name = self._release_name(session)
        session_path = self._session_path(session)

        return {
            "apiVersion": "traefik.io/v1alpha1",
            "kind": "Middleware",
            "metadata": {
                "name": f"{release_name}-strip",
                "namespace": self._namespace,
                "labels": self._build_labels(session),
            },
            "spec": {
                "stripPrefix": {
                    "prefixes": [session_path],
                },
            },
        }

    def _get_api_exception(self) -> type:
        """Get the ApiException class from kubernetes_asyncio."""
        from kubernetes_asyncio.client import rest

        return rest.ApiException

    def _get_api(self, api_class: str) -> Any:
        """Get a kubernetes API instance by class name."""
        from kubernetes_asyncio.client import (
            AppsV1Api,
            CoreV1Api,
            CustomObjectsApi,
            NetworkingV1Api,
        )

        api_map: dict[str, type] = {
            "AppsV1Api": AppsV1Api,
            "CoreV1Api": CoreV1Api,
            "NetworkingV1Api": NetworkingV1Api,
            "CustomObjectsApi": CustomObjectsApi,
        }
        cls = api_map[api_class]
        return cls(self._api_client)

    async def _apply_resource(
        self,
        api_method_create: str,
        api_method_patch: str,
        api_class: str,
        name: str,
        manifest: dict[str, Any],
    ) -> None:
        """Create or patch a Kubernetes resource via the async API."""
        api = self._get_api(api_class)
        api_exception = self._get_api_exception()

        create_fn = getattr(api, api_method_create)
        patch_fn = getattr(api, api_method_patch)

        try:
            await create_fn(namespace=self._namespace, body=manifest)
        except api_exception as exc:
            if exc.status == 409:
                logger.info(
                    "%s %s already exists, patching", api_class, name,
                )
                await patch_fn(
                    name=name,
                    namespace=self._namespace,
                    body=manifest,
                )
            else:
                raise

    async def _apply_custom_resource(
        self, manifest: dict[str, Any],
    ) -> None:
        """Apply a custom resource (create or update)."""
        api = self._get_api("CustomObjectsApi")
        api_exception = self._get_api_exception()

        api_version = manifest["apiVersion"]
        parts = api_version.split("/")
        group = parts[0]
        version = parts[1]
        kind = manifest["kind"]
        plural = kind.lower() + "s"
        name = manifest["metadata"]["name"]
        namespace = manifest["metadata"].get(
            "namespace", self._namespace,
        )

        try:
            await api.create_namespaced_custom_object(
                group=group,
                version=version,
                namespace=namespace,
                plural=plural,
                body=manifest,
            )
        except api_exception as exc:
            if exc.status == 409:
                await api.patch_namespaced_custom_object(
                    group=group,
                    version=version,
                    namespace=namespace,
                    plural=plural,
                    name=name,
                    body=manifest,
                )
            else:
                logger.warning(
                    "Failed to apply %s %s: %s", kind, name, exc,
                )
                raise

    async def _delete_custom_resource(
        self,
        group: str,
        version: str,
        plural: str,
        name: str,
    ) -> None:
        """Delete a custom resource, ignoring not-found errors."""
        api = self._get_api("CustomObjectsApi")
        api_exception = self._get_api_exception()

        try:
            await api.delete_namespaced_custom_object(
                group=group,
                version=version,
                namespace=self._namespace,
                plural=plural,
                name=name,
            )
        except api_exception as exc:
            if exc.status != 404:
                logger.warning(
                    "Failed to delete %s/%s: %s", plural, name, exc,
                )

    async def _delete_resource(
        self,
        api_class: str,
        api_method: str,
        name: str,
    ) -> bool:
        """Delete a Kubernetes resource, returning True if deleted."""
        api = self._get_api(api_class)
        api_exception = self._get_api_exception()

        try:
            fn = getattr(api, api_method)
            await fn(name=name, namespace=self._namespace)
            return True
        except api_exception as exc:
            if exc.status != 404:
                logger.error(
                    "Failed to delete %s %s: %s", api_class, name, exc,
                )
            return False

    async def _read_deployment(self, name: str) -> Any:
        """Read a Deployment, returning None if not found."""
        api = self._get_api("AppsV1Api")
        api_exception = self._get_api_exception()

        try:
            return await api.read_namespaced_deployment(
                name=name, namespace=self._namespace,
            )
        except api_exception as exc:
            if exc.status == 404:
                return None
            raise

    async def start(
        self,
        session: Session,
        spec: SessionSpec,
    ) -> PodStartResult:
        """Start Deployment + Service + Ingress for the session."""
        await self._ensure_client()

        release_name = self._release_name(session)

        # Create the Traefik strip-prefix middleware CR.
        middleware = self._build_strip_prefix_middleware(session)
        await self._apply_custom_resource(middleware)

        # Create the Deployment.
        deployment = self._build_deployment_manifest(session, spec)
        await self._apply_resource(
            api_method_create="create_namespaced_deployment",
            api_method_patch="patch_namespaced_deployment",
            api_class="AppsV1Api",
            name=release_name,
            manifest=deployment,
        )

        # Create the Service.
        service = self._build_service_manifest(session)
        await self._apply_resource(
            api_method_create="create_namespaced_service",
            api_method_patch="patch_namespaced_service",
            api_class="CoreV1Api",
            name=release_name,
            manifest=service,
        )

        # Create the Ingress.
        ingress = self._build_ingress_manifest(session)
        await self._apply_resource(
            api_method_create="create_namespaced_ingress",
            api_method_patch="patch_namespaced_ingress",
            api_class="NetworkingV1Api",
            name=release_name,
            manifest=ingress,
        )

        logger.info(
            "Created K8s resources for session %s in namespace %s",
            session.id,
            self._namespace,
        )

        return PodStartResult(
            chat_endpoint=self._chat_endpoint(session),
            code_endpoint=self._code_endpoint(session),
            pod_name=release_name,
        )

    async def stop(self, session: Session) -> bool:
        """Delete Deployment, Service, Ingress, and Middleware."""
        await self._ensure_client()

        release_name = self._release_name(session)

        d1 = await self._delete_resource(
            "AppsV1Api",
            "delete_namespaced_deployment",
            release_name,
        )
        d2 = await self._delete_resource(
            "CoreV1Api",
            "delete_namespaced_service",
            release_name,
        )
        d3 = await self._delete_resource(
            "NetworkingV1Api",
            "delete_namespaced_ingress",
            release_name,
        )

        await self._delete_custom_resource(
            group="traefik.io",
            version="v1alpha1",
            plural="middlewares",
            name=f"{release_name}-strip",
        )

        if d1 or d2 or d3:
            logger.info(
                "Deleted K8s resources for session %s", session.id,
            )

        return True

    async def status(self, session: Session) -> SessionStatus:
        """Get the current status of the session's pods."""
        await self._ensure_client()

        release_name = self._release_name(session)
        deployment = await self._read_deployment(release_name)

        if deployment is None:
            return SessionStatus.STOPPED

        return self._map_deployment_status(deployment)

    @staticmethod
    def _map_deployment_status(deployment: Any) -> SessionStatus:
        """Map Deployment status to SessionStatus."""
        status = deployment.status
        if status is None:
            return SessionStatus.STARTING

        ready = status.ready_replicas or 0
        desired = deployment.spec.replicas or 1

        if ready >= desired:
            return SessionStatus.RUNNING

        # Check for failure conditions.
        if status.conditions:
            for condition in status.conditions:
                if condition.type == "Available" and condition.status == "False":
                    if condition.reason in ("MinimumReplicasUnavailable",):
                        return SessionStatus.STARTING
                if condition.type == "Progressing" and condition.status == "False":
                    return SessionStatus.FAILED

        return SessionStatus.STARTING

    async def wait_for_ready(
        self,
        session: Session,
        timeout: float,
    ) -> SessionStatus:
        """Poll status until RUNNING or FAILED/timeout."""
        elapsed = 0.0
        while elapsed < timeout:
            current = await self.status(session)
            if current == SessionStatus.RUNNING:
                return SessionStatus.RUNNING
            if current == SessionStatus.FAILED:
                return SessionStatus.FAILED
            await asyncio.sleep(self._poll_interval)
            elapsed += self._poll_interval

        logger.warning(
            "Timed out waiting for session %s after %.1fs", session.id, timeout
        )
        return SessionStatus.FAILED

    async def close(self) -> None:
        """Close the Kubernetes API client."""
        if self._api_client is not None:
            await self._api_client.close()
            self._api_client = None
