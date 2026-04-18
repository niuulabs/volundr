"""Flock flow provider adapters.

Two adapters ship with Tyr:

- ``ConfigFlockFlowProvider`` — YAML file (dev default, mirrors ConfigProfileProvider).
- ``KubernetesConfigMapFlockFlowProvider`` — Kubernetes ConfigMap (k8s default).
"""

from tyr.adapters.flows.config import ConfigFlockFlowProvider
from tyr.adapters.flows.configmap import KubernetesConfigMapFlockFlowProvider

__all__ = [
    "ConfigFlockFlowProvider",
    "KubernetesConfigMapFlockFlowProvider",
]
