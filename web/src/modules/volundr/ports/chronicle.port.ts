import type { ChronicleEntry, ChronicleType } from '@/modules/volundr/models';

/**
 * Port interface for Chronicle service
 * Provides access to the event log
 */
export interface IChronicleService {
  /**
   * Get recent chronicle entries
   * @param limit Maximum number of entries to return
   */
  getEntries(limit?: number): Promise<ChronicleEntry[]>;

  /**
   * Get entries filtered by type
   */
  getEntriesByType(type: ChronicleType, limit?: number): Promise<ChronicleEntry[]>;

  /**
   * Get entries filtered by agent
   */
  getEntriesByAgent(agent: string, limit?: number): Promise<ChronicleEntry[]>;

  /**
   * Subscribe to new entries
   * @returns Unsubscribe function
   */
  subscribe(callback: (entry: ChronicleEntry) => void): () => void;
}
