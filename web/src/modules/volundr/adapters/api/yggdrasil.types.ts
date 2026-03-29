/**
 * Yggdrasil API Response Types
 *
 * These types match the OpenAPI specification from the Yggdrasil backend.
 * They are transformed to UI models in the adapter.
 */

export type ApiRealmStatus = 'healthy' | 'warning' | 'critical' | 'offline';

export type ApiEventSeverity = 'info' | 'warning' | 'error';

export interface ApiResourceUsage {
  capacity: number;
  allocatable: number;
  unit: string;
}

export interface ApiPodCounts {
  running: number;
  pending: number;
  failed: number;
  succeeded: number;
  unknown: number;
}

export interface ApiResourceTotals {
  cpu: ApiResourceUsage;
  memory: ApiResourceUsage;
  gpu_count: number;
  pod_counts: ApiPodCounts;
}

export interface ApiHealthInput {
  nodes_ready: number;
  nodes_total: number;
  pod_running_ratio: number;
  volumes_degraded: number;
  volumes_faulted: number;
  recent_error_count: number;
}

export interface ApiRealmHealth {
  status: ApiRealmStatus;
  inputs: ApiHealthInput;
  reason: string;
}

export interface ApiRealmSummary {
  realm_id: string;
  display_name: string;
  description: string;
  location: string;
  status: ApiRealmStatus;
  health: ApiRealmHealth;
  resources: ApiResourceTotals;
}

export interface ApiNodeCondition {
  condition_type: string;
  status: string;
  message: string;
}

export interface ApiNodeSnapshot {
  name: string;
  status: string;
  roles: string[];
  cpu: ApiResourceUsage;
  memory: ApiResourceUsage;
  gpu_count: number;
  conditions: ApiNodeCondition[];
}

export interface ApiWorkloadSummary {
  namespace_count: number;
  deployment_total: number;
  deployment_healthy: number;
  statefulset_count: number;
  daemonset_count: number;
  pods: ApiPodCounts;
}

export interface ApiVolumeCounts {
  healthy: number;
  degraded: number;
  faulted: number;
}

export interface ApiStorageSummary {
  total_capacity_bytes: number;
  used_bytes: number;
  volumes: ApiVolumeCounts;
}

export interface ApiInfraEvent {
  timestamp: string;
  severity: ApiEventSeverity;
  source: string;
  message: string;
  involved_object: string;
}

export interface ApiRealmDetail {
  realm_id: string;
  display_name: string;
  description: string;
  location: string;
  status: ApiRealmStatus;
  health: ApiRealmHealth;
  resources: ApiResourceTotals;
  nodes: ApiNodeSnapshot[];
  workloads: ApiWorkloadSummary;
  storage: ApiStorageSummary;
  events: ApiInfraEvent[];
}

export interface ApiHealthResponse {
  status: string;
  version: string;
  backend_connected: boolean;
}
