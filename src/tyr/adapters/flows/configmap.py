"""KubernetesConfigMapFlockFlowProvider — read/write through a k8s ConfigMap.

Follows the same RBAC approach as the persona registry ConfigMap introduced in
NIU-642. The ConfigMap stores all flows as a single ``flows.yaml`` key.

The ``kubernetes`` Python client is an optional dependency; a clear
``ImportError`` is raised at instantiation time when it is absent.
"""

from __future__ import annotations

import logging

import yaml

from tyr.adapters.flows.config import parse_flow
from tyr.domain.flock_flow import FlockFlowConfig
from tyr.ports.flock_flow import FlockFlowProvider

logger = logging.getLogger(__name__)

_FLOWS_KEY = "flows.yaml"


class KubernetesConfigMapFlockFlowProvider(FlockFlowProvider):
    """Reads and writes flock flows via a Kubernetes ConfigMap.

    The ConfigMap holds a single key ``flows.yaml`` whose value is a YAML list
    of flow dicts identical to the format used by ``ConfigFlockFlowProvider``.

    Example ``tyr.yaml``::

        flock_flows:
          adapter: tyr.adapters.flows.KubernetesConfigMapFlockFlowProvider
          kwargs:
            namespace: tyr
            configmap_name: flock-flows
    """

    def __init__(
        self,
        namespace: str = "tyr",
        configmap_name: str = "flock-flows",
    ) -> None:
        try:
            import kubernetes  # noqa: F401
        except ImportError as exc:
            raise ImportError(
                "KubernetesConfigMapFlockFlowProvider requires the 'kubernetes' package. "
                "Install it with: pip install kubernetes"
            ) from exc
        self._namespace = namespace
        self._configmap_name = configmap_name

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _k8s_client(self):  # noqa: ANN202
        """Return a configured CoreV1Api client (in-cluster or kubeconfig)."""
        from kubernetes import client, config

        try:
            config.load_incluster_config()
        except Exception:
            config.load_kube_config()
        return client.CoreV1Api()

    def _read_flows(self) -> dict[str, FlockFlowConfig]:
        """Read and parse all flows from the ConfigMap; returns empty dict on error."""
        try:
            v1 = self._k8s_client()
            cm = v1.read_namespaced_config_map(self._configmap_name, self._namespace)
            raw_text = (cm.data or {}).get(_FLOWS_KEY, "") or ""
            raw = yaml.safe_load(raw_text) if raw_text.strip() else []
            if not isinstance(raw, list):
                return {}
            flows: dict[str, FlockFlowConfig] = {}
            for item in raw:
                flow = parse_flow(item)
                if flow is not None:
                    flows[flow.name] = flow
            return flows
        except Exception:
            logger.warning(
                "KubernetesConfigMapFlockFlowProvider: failed to read ConfigMap %s/%s",
                self._namespace,
                self._configmap_name,
                exc_info=True,
            )
            return {}

    def _write_flows(self, flows: dict[str, FlockFlowConfig]) -> None:
        """Persist *flows* back to the ConfigMap, creating it if absent."""
        from kubernetes import client  # noqa: PLC0415

        v1 = self._k8s_client()
        text = yaml.dump(
            [f.to_dict() for f in flows.values()],
            default_flow_style=False,
            allow_unicode=True,
        )
        body = client.V1ConfigMap(
            api_version="v1",
            kind="ConfigMap",
            metadata=client.V1ObjectMeta(
                name=self._configmap_name,
                namespace=self._namespace,
            ),
            data={_FLOWS_KEY: text},
        )

        try:
            v1.replace_namespaced_config_map(self._configmap_name, self._namespace, body)
        except Exception:
            try:
                v1.create_namespaced_config_map(self._namespace, body)
            except Exception:
                logger.error(
                    "KubernetesConfigMapFlockFlowProvider: failed to write ConfigMap %s/%s",
                    self._namespace,
                    self._configmap_name,
                    exc_info=True,
                )

    # ------------------------------------------------------------------
    # FlockFlowProvider
    # ------------------------------------------------------------------

    def get(self, name: str) -> FlockFlowConfig | None:
        return self._read_flows().get(name)

    def list(self) -> list[FlockFlowConfig]:
        return list(self._read_flows().values())

    def save(self, flow: FlockFlowConfig) -> None:
        flows = self._read_flows()
        flows[flow.name] = flow
        self._write_flows(flows)

    def delete(self, name: str) -> bool:
        flows = self._read_flows()
        if name not in flows:
            return False
        del flows[name]
        self._write_flows(flows)
        return True
