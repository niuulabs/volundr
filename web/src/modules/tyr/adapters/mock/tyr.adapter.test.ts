import { describe, it, expect, beforeEach } from 'vitest';
import { MockTyrService } from './tyr.adapter';

describe('MockTyrService', () => {
  let service: MockTyrService;

  beforeEach(() => {
    service = new MockTyrService();
  });

  describe('getSagas', () => {
    it('returns array of sagas', async () => {
      const sagas = await service.getSagas();

      expect(Array.isArray(sagas)).toBe(true);
      expect(sagas.length).toBeGreaterThan(0);
    });

    it('returns sagas with expected properties', async () => {
      const sagas = await service.getSagas();
      const saga = sagas[0];

      expect(saga.id).toBeDefined();
      expect(saga.name).toBeDefined();
      expect(saga.tracker_id).toBeDefined();
      expect(saga.repos).toBeDefined();
      expect(saga.repos.length).toBeGreaterThan(0);
      expect(saga.feature_branch).toBeDefined();
      expect(saga.status).toBeDefined();
      expect(saga.confidence).toBeGreaterThanOrEqual(0);
      expect(saga.confidence).toBeLessThanOrEqual(1);
    });

    it('returns copies of sagas', async () => {
      const sagas1 = await service.getSagas();
      const sagas2 = await service.getSagas();

      expect(sagas1).not.toBe(sagas2);
    });
  });

  describe('getSaga', () => {
    it('returns a saga by id', async () => {
      const sagas = await service.getSagas();
      const expectedId = sagas[0].id;

      const saga = await service.getSaga(expectedId);

      expect(saga).not.toBeNull();
      expect(saga?.id).toBe(expectedId);
    });

    it('returns null for non-existent id', async () => {
      const saga = await service.getSaga('non-existent-id');

      expect(saga).toBeNull();
    });
  });

  describe('getPhases', () => {
    it('returns phases for a saga', async () => {
      const sagas = await service.getSagas();
      const phases = await service.getPhases(sagas[0].id);

      expect(Array.isArray(phases)).toBe(true);
      expect(phases.length).toBeGreaterThan(0);
    });

    it('returns phases with raids', async () => {
      const sagas = await service.getSagas();
      const phases = await service.getPhases(sagas[0].id);

      expect(phases[0].raids).toBeDefined();
      expect(phases[0].raids.length).toBeGreaterThan(0);
    });

    it('returns empty array for non-existent saga', async () => {
      const phases = await service.getPhases('non-existent-id');

      expect(phases).toEqual([]);
    });
  });

  describe('decompose', () => {
    it('returns phases after simulated delay', async () => {
      const phases = await service.decompose('New Feature', 'github.com/test/repo');

      expect(Array.isArray(phases)).toBe(true);
      expect(phases.length).toBeGreaterThan(0);
      expect(phases[0].raids.length).toBeGreaterThan(0);
    });

    it('returns phases with pending status', async () => {
      const phases = await service.decompose('New Feature', 'github.com/test/repo');

      expect(phases[0].status).toBe('pending');
    });
  });

  describe('createSaga', () => {
    it('returns a new saga with generated fields', async () => {
      const saga = await service.createSaga('Test Feature', 'github.com/test/repo');

      expect(saga.id).toBeDefined();
      expect(saga.name).toBe('Test Feature');
      expect(saga.repos).toContain('github.com/test/repo');
      expect(saga.status).toBe('active');
      expect(saga.tracker_id).toMatch(/^NIU-\d+$/);
    });
  });
});
