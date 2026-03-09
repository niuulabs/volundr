import type { IRealmService } from '@/ports';
import type {
  Realm,
  RealmDetail,
  NodeSnapshot,
  WorkloadSummary,
  StorageSummary,
  InfraEvent,
  RealmHealth,
  HealthInput,
  ResourceUsage,
  PodCounts,
  RealmResources,
  NodeCondition,
  VolumeCounts,
} from '@/models';
import type { HealthStatus } from '@/models';
import { createApiClient, ApiClientError } from './client';
import { getValkyrieForRealm } from '@/data/valkyries';
import type {
  ApiRealmSummary,
  ApiRealmDetail,
  ApiNodeSnapshot,
  ApiWorkloadSummary,
  ApiStorageSummary,
  ApiInfraEvent,
  ApiRealmHealth,
  ApiHealthInput,
  ApiResourceUsage,
  ApiPodCounts,
  ApiResourceTotals,
  ApiNodeCondition,
  ApiVolumeCounts,
} from './yggdrasil.types';

const api = createApiClient('/api/v1/yggdrasil');

// --- Transform helpers ---

function transformResourceUsage(raw: ApiResourceUsage): ResourceUsage {
  return {
    capacity: raw.capacity,
    allocatable: raw.allocatable,
    unit: raw.unit,
  };
}

function transformPodCounts(raw: ApiPodCounts): PodCounts {
  return {
    running: raw.running,
    pending: raw.pending,
    failed: raw.failed,
    succeeded: raw.succeeded,
    unknown: raw.unknown,
  };
}

function transformResources(raw: ApiResourceTotals): RealmResources {
  return {
    cpu: transformResourceUsage(raw.cpu),
    memory: transformResourceUsage(raw.memory),
    gpuCount: raw.gpu_count,
    pods: transformPodCounts(raw.pod_counts),
  };
}

function transformHealthInput(raw: ApiHealthInput): HealthInput {
  return {
    nodesReady: raw.nodes_ready,
    nodesTotal: raw.nodes_total,
    podRunningRatio: raw.pod_running_ratio,
    volumesDegraded: raw.volumes_degraded,
    volumesFaulted: raw.volumes_faulted,
    recentErrorCount: raw.recent_error_count,
  };
}

function transformHealth(raw: ApiRealmHealth): RealmHealth {
  return {
    status: raw.status as HealthStatus,
    inputs: transformHealthInput(raw.inputs),
    reason: raw.reason,
  };
}

function transformRealmSummary(raw: ApiRealmSummary): Realm {
  return {
    id: raw.realm_id,
    name: raw.display_name,
    description: raw.description,
    location: raw.location,
    status: raw.status as HealthStatus,
    health: transformHealth(raw.health),
    resources: transformResources(raw.resources),
    valkyrie: getValkyrieForRealm(raw.realm_id),
  };
}

function transformNodeCondition(raw: ApiNodeCondition): NodeCondition {
  return {
    conditionType: raw.condition_type,
    status: raw.status,
    message: raw.message,
  };
}

function transformNode(raw: ApiNodeSnapshot): NodeSnapshot {
  return {
    name: raw.name,
    status: raw.status,
    roles: raw.roles ?? [],
    cpu: transformResourceUsage(raw.cpu),
    memory: transformResourceUsage(raw.memory),
    gpuCount: raw.gpu_count,
    conditions: (raw.conditions ?? []).map(transformNodeCondition),
  };
}

function transformWorkloads(raw: ApiWorkloadSummary): WorkloadSummary {
  return {
    namespaceCount: raw.namespace_count,
    deploymentTotal: raw.deployment_total,
    deploymentHealthy: raw.deployment_healthy,
    statefulsetCount: raw.statefulset_count,
    daemonsetCount: raw.daemonset_count,
    pods: transformPodCounts(raw.pods),
  };
}

function transformVolumeCounts(raw: ApiVolumeCounts): VolumeCounts {
  return {
    healthy: raw.healthy,
    degraded: raw.degraded,
    faulted: raw.faulted,
  };
}

function transformStorage(raw: ApiStorageSummary): StorageSummary {
  return {
    totalCapacityBytes: raw.total_capacity_bytes,
    usedBytes: raw.used_bytes,
    volumes: transformVolumeCounts(raw.volumes),
  };
}

function transformEvent(raw: ApiInfraEvent): InfraEvent {
  return {
    timestamp: raw.timestamp,
    severity: raw.severity,
    source: raw.source,
    message: raw.message,
    involvedObject: raw.involved_object,
  };
}

function transformRealmDetail(raw: ApiRealmDetail): RealmDetail {
  return {
    id: raw.realm_id,
    name: raw.display_name,
    description: raw.description,
    location: raw.location,
    status: raw.status as HealthStatus,
    health: transformHealth(raw.health),
    resources: transformResources(raw.resources),
    valkyrie: getValkyrieForRealm(raw.realm_id),
    nodes: (raw.nodes ?? []).map(transformNode),
    workloads: transformWorkloads(raw.workloads),
    storage: transformStorage(raw.storage),
    events: (raw.events ?? []).map(transformEvent),
  };
}

/**
 * API implementation of IRealmService backed by Yggdrasil
 */
export class ApiRealmService implements IRealmService {
  private subscribers = new Set<(realms: Realm[]) => void>();
  private cachedRealms: Realm[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  async getRealms(): Promise<Realm[]> {
    const response = await api.get<ApiRealmSummary[]>('/realms');
    this.cachedRealms = response.map(transformRealmSummary);
    return [...this.cachedRealms];
  }

  async getRealm(id: string): Promise<Realm | null> {
    try {
      const response = await api.get<ApiRealmSummary[]>('/realms');
      const match = response.find(r => r.realm_id === id);
      if (!match) return null;
      return transformRealmSummary(match);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getRealmDetail(id: string): Promise<RealmDetail | null> {
    try {
      const response = await api.get<ApiRealmDetail>(`/realms/${id}`);
      return transformRealmDetail(response);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getRealmNodes(id: string): Promise<NodeSnapshot[]> {
    const response = await api.get<ApiNodeSnapshot[]>(`/realms/${id}/nodes`);
    return response.map(transformNode);
  }

  async getRealmWorkloads(id: string): Promise<WorkloadSummary | null> {
    try {
      const response = await api.get<ApiWorkloadSummary>(`/realms/${id}/workloads`);
      return transformWorkloads(response);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getRealmStorage(id: string): Promise<StorageSummary | null> {
    try {
      const response = await api.get<ApiStorageSummary>(`/realms/${id}/storage`);
      return transformStorage(response);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async getRealmEvents(id: string, since?: string, severity?: string): Promise<InfraEvent[]> {
    const params = new URLSearchParams();
    if (since) params.set('since', since);
    if (severity) params.set('severity', severity);
    const qs = params.toString();
    const endpoint = `/realms/${id}/events${qs ? `?${qs}` : ''}`;
    const response = await api.get<ApiInfraEvent[]>(endpoint);
    return response.map(transformEvent);
  }

  subscribe(callback: (realms: Realm[]) => void): () => void {
    this.subscribers.add(callback);

    // Start polling if this is the first subscriber
    if (this.subscribers.size === 1) {
      this.startPolling();
    }

    // Immediately notify with cached data
    if (this.cachedRealms.length > 0) {
      callback([...this.cachedRealms]);
    }

    return () => {
      this.subscribers.delete(callback);
      if (this.subscribers.size === 0) {
        this.stopPolling();
      }
    };
  }

  private startPolling(): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(async () => {
      try {
        const realms = await this.getRealms();
        for (const callback of this.subscribers) {
          callback([...realms]);
        }
      } catch {
        // Silently skip poll failures — next tick will retry
      }
    }, 30_000);
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
