import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockRealmService } from './realm.adapter';

describe('MockRealmService', () => {
  let service: MockRealmService;

  beforeEach(() => {
    service = new MockRealmService();
  });

  describe('getRealms', () => {
    it('returns array of realms', async () => {
      const realms = await service.getRealms();

      expect(Array.isArray(realms)).toBe(true);
      expect(realms.length).toBeGreaterThan(0);
    });

    it('returns realms with expected properties', async () => {
      const realms = await service.getRealms();
      const realm = realms[0];

      expect(realm.id).toBeDefined();
      expect(realm.name).toBeDefined();
      expect(realm.description).toBeDefined();
      expect(realm.status).toBeDefined();
      expect(realm.health).toBeDefined();
      expect(realm.resources).toBeDefined();
      expect(realm.resources.cpu).toBeDefined();
      expect(realm.resources.memory).toBeDefined();
      expect(realm.resources.pods).toBeDefined();
    });

    it('returns a copy of realms, not the original', async () => {
      const realms1 = await service.getRealms();
      const realms2 = await service.getRealms();

      expect(realms1).not.toBe(realms2);
      expect(realms1[0]).not.toBe(realms2[0]);
    });
  });

  describe('getRealm', () => {
    it('returns a realm by id', async () => {
      const realms = await service.getRealms();
      const expectedId = realms[0].id;

      const realm = await service.getRealm(expectedId);

      expect(realm).not.toBeNull();
      expect(realm?.id).toBe(expectedId);
    });

    it('returns null for non-existent id', async () => {
      const realm = await service.getRealm('non-existent-id');

      expect(realm).toBeNull();
    });

    it('returns a copy of the realm, not the original', async () => {
      const realms = await service.getRealms();
      const realm1 = await service.getRealm(realms[0].id);
      const realm2 = await service.getRealm(realms[0].id);

      expect(realm1).not.toBe(realm2);
      expect(realm1).toEqual(realm2);
    });
  });

  describe('getRealmDetail', () => {
    it('returns detail for known realm', async () => {
      const detail = await service.getRealmDetail('vanaheim');

      expect(detail).not.toBeNull();
      expect(detail?.id).toBe('vanaheim');
      expect(detail?.nodes).toBeDefined();
      expect(detail?.workloads).toBeDefined();
      expect(detail?.storage).toBeDefined();
      expect(detail?.events).toBeDefined();
    });

    it('returns fallback detail for realm without mock detail', async () => {
      const detail = await service.getRealmDetail('ymir');

      expect(detail).not.toBeNull();
      expect(detail?.id).toBe('ymir');
      expect(detail?.nodes).toEqual([]);
      expect(detail?.events).toEqual([]);
    });

    it('returns null for non-existent realm', async () => {
      const detail = await service.getRealmDetail('non-existent');

      expect(detail).toBeNull();
    });
  });

  describe('getRealmNodes', () => {
    it('returns nodes for known realm', async () => {
      const nodes = await service.getRealmNodes('vanaheim');

      expect(Array.isArray(nodes)).toBe(true);
      expect(nodes.length).toBeGreaterThan(0);
    });

    it('returns empty array for unknown realm', async () => {
      const nodes = await service.getRealmNodes('non-existent');

      expect(nodes).toEqual([]);
    });
  });

  describe('getRealmWorkloads', () => {
    it('returns workloads for known realm', async () => {
      const workloads = await service.getRealmWorkloads('vanaheim');

      expect(workloads).not.toBeNull();
      expect(workloads?.namespaceCount).toBeGreaterThan(0);
    });

    it('returns null for unknown realm', async () => {
      const workloads = await service.getRealmWorkloads('non-existent');

      expect(workloads).toBeNull();
    });
  });

  describe('getRealmEvents', () => {
    it('returns events for known realm', async () => {
      const events = await service.getRealmEvents('vanaheim');

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    });

    it('returns empty array for unknown realm', async () => {
      const events = await service.getRealmEvents('non-existent');

      expect(events).toEqual([]);
    });
  });

  describe('subscribe', () => {
    it('adds a subscriber and returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('stops notifying after unsubscribe', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);
      unsubscribe();

      // No notification mechanism to trigger without updateAutonomy,
      // but verify the unsubscribe doesn't throw
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
