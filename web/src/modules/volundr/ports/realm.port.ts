import type {
  Realm,
  RealmDetail,
  NodeSnapshot,
  WorkloadSummary,
  StorageSummary,
  InfraEvent,
} from '@/modules/volundr/models';

/**
 * Port interface for Realm service
 * Provides access to infrastructure realms via Yggdrasil
 */
export interface IRealmService {
  /**
   * Get all realms (summary level)
   */
  getRealms(): Promise<Realm[]>;

  /**
   * Get a specific realm summary by ID
   */
  getRealm(id: string): Promise<Realm | null>;

  /**
   * Get full realm detail including nodes, workloads, storage, events
   */
  getRealmDetail(id: string): Promise<RealmDetail | null>;

  /**
   * Get nodes for a realm
   */
  getRealmNodes(id: string): Promise<NodeSnapshot[]>;

  /**
   * Get workload summary for a realm
   */
  getRealmWorkloads(id: string): Promise<WorkloadSummary | null>;

  /**
   * Get storage summary for a realm
   */
  getRealmStorage(id: string): Promise<StorageSummary | null>;

  /**
   * Get infrastructure events for a realm
   */
  getRealmEvents(id: string, since?: string, severity?: string): Promise<InfraEvent[]>;

  /**
   * Subscribe to realm list updates
   * @returns Unsubscribe function
   */
  subscribe(callback: (realms: Realm[]) => void): () => void;
}
