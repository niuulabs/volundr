import type { OdinState, PendingDecision } from '@/models';

/**
 * Port interface for ODIN core service
 * Provides access to ODIN's consciousness state and decision management
 */
export interface IOdinService {
  /**
   * Get current ODIN state
   */
  getState(): Promise<OdinState>;

  /**
   * Subscribe to state updates
   * @returns Unsubscribe function
   */
  subscribe(callback: (state: OdinState) => void): () => void;

  /**
   * Approve a pending decision
   */
  approveDecision(decisionId: string): Promise<void>;

  /**
   * Reject a pending decision
   */
  rejectDecision(decisionId: string): Promise<void>;

  /**
   * Get pending decisions requiring human input
   */
  getPendingDecisions(): Promise<PendingDecision[]>;
}
