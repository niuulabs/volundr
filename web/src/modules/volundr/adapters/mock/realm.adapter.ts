import type { IRealmService } from '@/modules/volundr/ports';
import type {
  Realm,
  RealmDetail,
  NodeSnapshot,
  WorkloadSummary,
  StorageSummary,
  InfraEvent,
} from '@/modules/volundr/models';
import { mockRealms, mockRealmDetails } from './data';

/**
 * Mock implementation of IRealmService
 * Returns canned data for development and testing
 */
export class MockRealmService implements IRealmService {
  private realms: Realm[] = mockRealms.map(r => ({ ...r }));
  private subscribers: Set<(realms: Realm[]) => void> = new Set();

  async getRealms(): Promise<Realm[]> {
    return this.realms.map(r => ({ ...r }));
  }

  async getRealm(id: string): Promise<Realm | null> {
    const realm = this.realms.find(r => r.id === id);
    return realm ? { ...realm } : null;
  }

  async getRealmDetail(id: string): Promise<RealmDetail | null> {
    const detail = mockRealmDetails[id];
    if (detail) return { ...detail };

    // Fall back to building a minimal detail from summary
    const realm = this.realms.find(r => r.id === id);
    if (!realm) return null;

    return {
      ...realm,
      nodes: [],
      workloads: {
        namespaceCount: 0,
        deploymentTotal: 0,
        deploymentHealthy: 0,
        statefulsetCount: 0,
        daemonsetCount: 0,
        pods: { running: 0, pending: 0, failed: 0, succeeded: 0, unknown: 0 },
      },
      storage: {
        totalCapacityBytes: 0,
        usedBytes: 0,
        volumes: { healthy: 0, degraded: 0, faulted: 0 },
      },
      events: [],
    };
  }

  async getRealmNodes(id: string): Promise<NodeSnapshot[]> {
    const detail = mockRealmDetails[id];
    return detail?.nodes ?? [];
  }

  async getRealmWorkloads(id: string): Promise<WorkloadSummary | null> {
    const detail = mockRealmDetails[id];
    return detail?.workloads ?? null;
  }

  async getRealmStorage(id: string): Promise<StorageSummary | null> {
    const detail = mockRealmDetails[id];
    return detail?.storage ?? null;
  }

  async getRealmEvents(id: string): Promise<InfraEvent[]> {
    const detail = mockRealmDetails[id];
    return detail?.events ?? [];
  }

  subscribe(callback: (realms: Realm[]) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }
}
