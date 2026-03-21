import type { IEinherjarService } from '@/modules/volundr/ports';
import type { Einherjar, EinherjarStats } from '@/modules/volundr/models';
import { mockEinherjar } from './data';

/**
 * Mock implementation of IEinherjarService
 * Returns canned data for development and testing
 */
export class MockEinherjarService implements IEinherjarService {
  private workers: Einherjar[] = mockEinherjar.map(w => ({ ...w }));
  private subscribers: Set<(workers: Einherjar[]) => void> = new Set();

  async getEinherjar(): Promise<Einherjar[]> {
    return this.workers.map(w => ({ ...w }));
  }

  async getWorker(id: string): Promise<Einherjar | null> {
    const worker = this.workers.find(w => w.id === id);
    return worker ? { ...worker } : null;
  }

  async getWorkersByStatus(status: 'working' | 'idle'): Promise<Einherjar[]> {
    return this.workers.filter(w => w.status === status).map(w => ({ ...w }));
  }

  async getWorkersByCampaign(campaignId: string): Promise<Einherjar[]> {
    return this.workers.filter(w => w.campaign === campaignId).map(w => ({ ...w }));
  }

  async getStats(): Promise<EinherjarStats> {
    const working = this.workers.filter(w => w.status === 'working').length;
    const idle = this.workers.filter(w => w.status === 'idle').length;
    return {
      total: this.workers.length,
      working,
      idle,
    };
  }

  subscribe(callback: (workers: Einherjar[]) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async forceCheckpoint(workerId: string): Promise<void> {
    const worker = this.workers.find(w => w.id === workerId);
    if (worker) {
      worker.cyclesSinceCheckpoint = 0;
      this.notifySubscribers();
    }
  }

  async reassignWorker(workerId: string, campaignId: string | null): Promise<void> {
    const worker = this.workers.find(w => w.id === workerId);
    if (worker) {
      worker.campaign = campaignId;
      worker.phase = null;
      worker.status = campaignId ? 'working' : 'idle';
      worker.task = campaignId ? 'Awaiting task assignment' : 'Awaiting assignment';
      this.notifySubscribers();
    }
  }

  private notifySubscribers(): void {
    for (const callback of this.subscribers) {
      callback(this.workers.map(w => ({ ...w })));
    }
  }
}
