import type { IOdinService } from '@/ports';
import type { OdinState, PendingDecision } from '@/models';
import { mockOdinState } from './data';

/**
 * Mock implementation of IOdinService
 * Returns canned data for development and testing
 */
export class MockOdinService implements IOdinService {
  private state: OdinState = { ...mockOdinState };
  private subscribers: Set<(state: OdinState) => void> = new Set();

  async getState(): Promise<OdinState> {
    return { ...this.state };
  }

  subscribe(callback: (state: OdinState) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async approveDecision(decisionId: string): Promise<void> {
    this.state = {
      ...this.state,
      pendingDecisions: this.state.pendingDecisions.filter(d => d.id !== decisionId),
    };
    this.notifySubscribers();
  }

  async rejectDecision(decisionId: string): Promise<void> {
    this.state = {
      ...this.state,
      pendingDecisions: this.state.pendingDecisions.filter(d => d.id !== decisionId),
    };
    this.notifySubscribers();
  }

  async getPendingDecisions(): Promise<PendingDecision[]> {
    return [...this.state.pendingDecisions];
  }

  private notifySubscribers(): void {
    for (const callback of this.subscribers) {
      callback({ ...this.state });
    }
  }
}
