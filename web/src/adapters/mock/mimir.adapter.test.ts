import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockMimirService } from './mimir.adapter';

describe('MockMimirService', () => {
  let service: MockMimirService;

  beforeEach(() => {
    service = new MockMimirService();
  });

  describe('getStats', () => {
    it('returns Mimir statistics', async () => {
      const stats = await service.getStats();

      expect(stats.totalConsultations).toBeDefined();
      expect(stats.consultationsToday).toBeDefined();
      expect(stats.tokensUsedToday).toBeDefined();
      expect(stats.tokensUsedMonth).toBeDefined();
      expect(stats.costToday).toBeDefined();
      expect(stats.costMonth).toBeDefined();
      expect(stats.avgResponseTime).toBeDefined();
      expect(stats.model).toBeDefined();
    });

    it('returns a copy of stats', async () => {
      const stats1 = await service.getStats();
      const stats2 = await service.getStats();

      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  describe('getConsultations', () => {
    it('returns array of consultations', async () => {
      const consultations = await service.getConsultations();

      expect(Array.isArray(consultations)).toBe(true);
      expect(consultations.length).toBeGreaterThan(0);
    });

    it('returns consultations with expected properties', async () => {
      const consultations = await service.getConsultations();
      const consultation = consultations[0];

      expect(consultation.id).toBeDefined();
      expect(consultation.time).toBeDefined();
      expect(consultation.requester).toBeDefined();
      expect(consultation.topic).toBeDefined();
      expect(consultation.query).toBeDefined();
      expect(consultation.response).toBeDefined();
      expect(consultation.tokensIn).toBeDefined();
      expect(consultation.tokensOut).toBeDefined();
      expect(consultation.latency).toBeDefined();
    });

    it('respects limit parameter', async () => {
      const consultations = await service.getConsultations(2);

      expect(consultations.length).toBeLessThanOrEqual(2);
    });

    it('uses default limit of 50', async () => {
      const consultations = await service.getConsultations();

      expect(consultations.length).toBeLessThanOrEqual(50);
    });

    it('returns copies of consultations', async () => {
      const consultations1 = await service.getConsultations();
      const consultations2 = await service.getConsultations();

      expect(consultations1).not.toBe(consultations2);
    });
  });

  describe('getConsultation', () => {
    it('returns a consultation by id', async () => {
      const consultations = await service.getConsultations();
      const expectedId = consultations[0].id;

      const consultation = await service.getConsultation(expectedId);

      expect(consultation).not.toBeNull();
      expect(consultation?.id).toBe(expectedId);
    });

    it('returns null for non-existent id', async () => {
      const consultation = await service.getConsultation('non-existent-id');

      expect(consultation).toBeNull();
    });

    it('returns a copy of the consultation', async () => {
      const consultations = await service.getConsultations();
      const consultation1 = await service.getConsultation(consultations[0].id);
      const consultation2 = await service.getConsultation(consultations[0].id);

      expect(consultation1).not.toBe(consultation2);
      expect(consultation1).toEqual(consultation2);
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('can unsubscribe successfully', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      // Should not throw
      unsubscribe();
    });
  });

  describe('rateConsultation', () => {
    it('updates the useful flag to true', async () => {
      const consultations = await service.getConsultations();
      const consultationId = consultations[0].id;

      await service.rateConsultation(consultationId, true);

      const updated = await service.getConsultation(consultationId);
      expect(updated?.useful).toBe(true);
    });

    it('updates the useful flag to false', async () => {
      const consultations = await service.getConsultations();
      const consultationId = consultations[0].id;

      await service.rateConsultation(consultationId, false);

      const updated = await service.getConsultation(consultationId);
      expect(updated?.useful).toBe(false);
    });

    it('does nothing for non-existent consultation', async () => {
      // Should not throw
      await service.rateConsultation('non-existent-id', true);
    });
  });
});
