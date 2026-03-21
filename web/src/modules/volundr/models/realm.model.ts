import type { HealthStatus, ValkyrieStatus } from './status.model';

// --- Valkyrie (client-side, stubbed until Valkyrie services exist) ---

export interface ValkyrieInfo {
  name: string;
  status: ValkyrieStatus;
  uptime: string;
  observationsToday: number;
  specialty: string;
}

// --- Resource primitives (match Yggdrasil API shapes) ---

export interface ResourceUsage {
  capacity: number;
  allocatable: number;
  unit: string;
}

export interface PodCounts {
  running: number;
  pending: number;
  failed: number;
  succeeded: number;
  unknown: number;
}

export interface RealmResources {
  cpu: ResourceUsage;
  memory: ResourceUsage;
  gpuCount: number;
  pods: PodCounts;
}

// --- Health ---

export interface HealthInput {
  nodesReady: number;
  nodesTotal: number;
  podRunningRatio: number;
  volumesDegraded: number;
  volumesFaulted: number;
  recentErrorCount: number;
}

export interface RealmHealth {
  status: HealthStatus;
  inputs: HealthInput;
  reason: string;
}

// --- Realm summary (list / cards) ---

export interface Realm {
  id: string;
  name: string;
  description: string;
  location: string;
  status: HealthStatus;
  health: RealmHealth;
  resources: RealmResources;
  valkyrie: ValkyrieInfo | null;
}

// --- Detail sub-resources ---

export interface NodeCondition {
  conditionType: string;
  status: string;
  message: string;
}

export interface NodeSnapshot {
  name: string;
  status: string;
  roles: string[];
  cpu: ResourceUsage;
  memory: ResourceUsage;
  gpuCount: number;
  conditions: NodeCondition[];
}

export interface WorkloadSummary {
  namespaceCount: number;
  deploymentTotal: number;
  deploymentHealthy: number;
  statefulsetCount: number;
  daemonsetCount: number;
  pods: PodCounts;
}

export interface VolumeCounts {
  healthy: number;
  degraded: number;
  faulted: number;
}

export interface StorageSummary {
  totalCapacityBytes: number;
  usedBytes: number;
  volumes: VolumeCounts;
}

export type EventSeverity = 'info' | 'warning' | 'error';

export interface InfraEvent {
  timestamp: string;
  severity: EventSeverity;
  source: string;
  message: string;
  involvedObject: string;
}

// --- Realm detail (full page) ---

export interface RealmDetail extends Realm {
  nodes: NodeSnapshot[];
  workloads: WorkloadSummary;
  storage: StorageSummary;
  events: InfraEvent[];
}
