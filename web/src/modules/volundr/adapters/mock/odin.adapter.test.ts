import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockOdinService } from './odin.adapter';

describe('MockOdinService', () => {
  let service: MockOdinService;

  beforeEach(() => {
    service = new MockOdinService();
  });

  describe('getState', () => {
    it('returns the current ODIN state', async () => {
      const state = await service.getState();

      expect(state).toBeDefined();
      expect(state.status).toBeDefined();
      expect(state.loopCycle).toBeDefined();
      expect(state.loopPhase).toBeDefined();
      expect(state.currentThought).toBeDefined();
      expect(state.attention).toBeDefined();
      expect(state.disposition).toBeDefined();
      expect(state.circadianMode).toBeDefined();
      expect(state.resources).toBeDefined();
      expect(state.stats).toBeDefined();
      expect(state.pendingDecisions).toBeDefined();
    });

    it('returns a copy of state, not the original', async () => {
      const state1 = await service.getState();
      const state2 = await service.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('subscribe', () => {
    it('adds a subscriber and returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('notifies subscribers when state changes', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      const decisions = await service.getPendingDecisions();
      if (decisions.length > 0) {
        await service.approveDecision(decisions[0].id);
        expect(callback).toHaveBeenCalled();
      }
    });

    it('stops notifying after unsubscribe', async () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);
      unsubscribe();

      const decisions = await service.getPendingDecisions();
      if (decisions.length > 0) {
        await service.approveDecision(decisions[0].id);
        expect(callback).not.toHaveBeenCalled();
      }
    });
  });

  describe('approveDecision', () => {
    it('removes the decision from pending decisions', async () => {
      const decisionsBefore = await service.getPendingDecisions();

      if (decisionsBefore.length > 0) {
        const decisionId = decisionsBefore[0].id;
        await service.approveDecision(decisionId);

        const decisionsAfter = await service.getPendingDecisions();
        expect(decisionsAfter.find(d => d.id === decisionId)).toBeUndefined();
        expect(decisionsAfter.length).toBe(decisionsBefore.length - 1);
      }
    });
  });

  describe('rejectDecision', () => {
    it('removes the decision from pending decisions', async () => {
      const decisionsBefore = await service.getPendingDecisions();

      if (decisionsBefore.length > 0) {
        const decisionId = decisionsBefore[0].id;
        await service.rejectDecision(decisionId);

        const decisionsAfter = await service.getPendingDecisions();
        expect(decisionsAfter.find(d => d.id === decisionId)).toBeUndefined();
      }
    });
  });

  describe('getPendingDecisions', () => {
    it('returns array of pending decisions', async () => {
      const decisions = await service.getPendingDecisions();

      expect(Array.isArray(decisions)).toBe(true);
    });

    it('returns a copy of decisions, not the original', async () => {
      const decisions1 = await service.getPendingDecisions();
      const decisions2 = await service.getPendingDecisions();

      expect(decisions1).not.toBe(decisions2);
    });
  });
});
