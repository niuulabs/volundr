import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockEinherjarService } from './einherjar.adapter';

describe('MockEinherjarService', () => {
  let service: MockEinherjarService;

  beforeEach(() => {
    service = new MockEinherjarService();
  });

  describe('getEinherjar', () => {
    it('returns array of workers', async () => {
      const workers = await service.getEinherjar();

      expect(Array.isArray(workers)).toBe(true);
      expect(workers.length).toBeGreaterThan(0);
    });

    it('returns workers with expected properties', async () => {
      const workers = await service.getEinherjar();
      const worker = workers[0];

      expect(worker.id).toBeDefined();
      expect(worker.name).toBeDefined();
      expect(worker.status).toBeDefined();
      expect(worker.realm).toBeDefined();
    });

    it('returns copies of workers', async () => {
      const workers1 = await service.getEinherjar();
      const workers2 = await service.getEinherjar();

      expect(workers1).not.toBe(workers2);
    });
  });

  describe('getWorker', () => {
    it('returns a worker by id', async () => {
      const workers = await service.getEinherjar();
      const expectedId = workers[0].id;

      const worker = await service.getWorker(expectedId);

      expect(worker).not.toBeNull();
      expect(worker?.id).toBe(expectedId);
    });

    it('returns null for non-existent id', async () => {
      const worker = await service.getWorker('non-existent-id');
      expect(worker).toBeNull();
    });
  });

  describe('getWorkersByStatus', () => {
    it('returns only working workers when status is working', async () => {
      const workers = await service.getWorkersByStatus('working');

      for (const worker of workers) {
        expect(worker.status).toBe('working');
      }
    });

    it('returns only idle workers when status is idle', async () => {
      const workers = await service.getWorkersByStatus('idle');

      for (const worker of workers) {
        expect(worker.status).toBe('idle');
      }
    });
  });

  describe('getWorkersByCampaign', () => {
    it('returns workers assigned to a specific campaign', async () => {
      const workers = await service.getEinherjar();
      const workerWithCampaign = workers.find(w => w.campaign);

      if (workerWithCampaign?.campaign) {
        const campaignWorkers = await service.getWorkersByCampaign(workerWithCampaign.campaign);

        for (const worker of campaignWorkers) {
          expect(worker.campaign).toBe(workerWithCampaign.campaign);
        }
      }
    });

    it('returns empty array for non-existent campaign', async () => {
      const workers = await service.getWorkersByCampaign('non-existent-campaign');
      expect(workers).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('returns worker statistics', async () => {
      const stats = await service.getStats();

      expect(stats.total).toBeDefined();
      expect(stats.working).toBeDefined();
      expect(stats.idle).toBeDefined();
      expect(stats.total).toBe(stats.working + stats.idle);
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('notifies subscribers when worker is updated', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      const workers = await service.getEinherjar();
      await service.forceCheckpoint(workers[0].id);

      expect(callback).toHaveBeenCalled();
    });

    it('stops notifying after unsubscribe', async () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);
      unsubscribe();

      const workers = await service.getEinherjar();
      await service.forceCheckpoint(workers[0].id);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('forceCheckpoint', () => {
    it('resets cyclesSinceCheckpoint to 0', async () => {
      const workers = await service.getEinherjar();
      const workerId = workers[0].id;

      await service.forceCheckpoint(workerId);

      const updatedWorker = await service.getWorker(workerId);
      expect(updatedWorker?.cyclesSinceCheckpoint).toBe(0);
    });

    it('does nothing for non-existent worker', async () => {
      // Should not throw
      await service.forceCheckpoint('non-existent-id');
    });
  });

  describe('reassignWorker', () => {
    it('assigns worker to a new campaign', async () => {
      const workers = await service.getEinherjar();
      const idleWorker = workers.find(w => w.status === 'idle');

      if (idleWorker) {
        await service.reassignWorker(idleWorker.id, 'new-campaign-id');

        const updatedWorker = await service.getWorker(idleWorker.id);
        expect(updatedWorker?.campaign).toBe('new-campaign-id');
        expect(updatedWorker?.status).toBe('working');
      }
    });

    it('unassigns worker when campaignId is null', async () => {
      const workers = await service.getEinherjar();
      const workingWorker = workers.find(w => w.status === 'working');

      if (workingWorker) {
        await service.reassignWorker(workingWorker.id, null);

        const updatedWorker = await service.getWorker(workingWorker.id);
        expect(updatedWorker?.campaign).toBeNull();
        expect(updatedWorker?.status).toBe('idle');
      }
    });

    it('does nothing for non-existent worker', async () => {
      // Should not throw
      await service.reassignWorker('non-existent-id', 'campaign-id');
    });
  });
});
