import type { Einherjar, EinherjarStats } from '@/modules/volundr/models';

/**
 * Port interface for Einherjar service
 * Manages worker agents (coding agents)
 */
export interface IEinherjarService {
  /**
   * Get all Einherjar workers
   */
  getEinherjar(): Promise<Einherjar[]>;

  /**
   * Get a specific worker by ID
   */
  getWorker(id: string): Promise<Einherjar | null>;

  /**
   * Get workers by status
   */
  getWorkersByStatus(status: 'working' | 'idle'): Promise<Einherjar[]>;

  /**
   * Get workers assigned to a campaign
   */
  getWorkersByCampaign(campaignId: string): Promise<Einherjar[]>;

  /**
   * Get worker statistics
   */
  getStats(): Promise<EinherjarStats>;

  /**
   * Subscribe to worker updates
   * @returns Unsubscribe function
   */
  subscribe(callback: (workers: Einherjar[]) => void): () => void;

  /**
   * Force checkpoint for a worker
   */
  forceCheckpoint(workerId: string): Promise<void>;

  /**
   * Reassign a worker to a different campaign
   */
  reassignWorker(workerId: string, campaignId: string | null): Promise<void>;
}
