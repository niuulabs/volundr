import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockCampaignService } from './campaign.adapter';

describe('MockCampaignService', () => {
  let service: MockCampaignService;

  beforeEach(() => {
    service = new MockCampaignService();
  });

  describe('getCampaigns', () => {
    it('returns array of campaigns', async () => {
      const campaigns = await service.getCampaigns();

      expect(Array.isArray(campaigns)).toBe(true);
      expect(campaigns.length).toBeGreaterThan(0);
    });

    it('returns campaigns with expected properties', async () => {
      const campaigns = await service.getCampaigns();
      const campaign = campaigns[0];

      expect(campaign.id).toBeDefined();
      expect(campaign.name).toBeDefined();
      expect(campaign.status).toBeDefined();
      expect(campaign.progress).toBeDefined();
      expect(campaign.phases).toBeDefined();
    });

    it('returns a copy of campaigns', async () => {
      const campaigns1 = await service.getCampaigns();
      const campaigns2 = await service.getCampaigns();

      expect(campaigns1).not.toBe(campaigns2);
    });
  });

  describe('getCampaign', () => {
    it('returns a campaign by id', async () => {
      const campaigns = await service.getCampaigns();
      const expectedId = campaigns[0].id;

      const campaign = await service.getCampaign(expectedId);

      expect(campaign).not.toBeNull();
      expect(campaign?.id).toBe(expectedId);
    });

    it('returns null for non-existent id', async () => {
      const campaign = await service.getCampaign('non-existent-id');
      expect(campaign).toBeNull();
    });
  });

  describe('getActiveCampaigns', () => {
    it('returns only active campaigns', async () => {
      const activeCampaigns = await service.getActiveCampaigns();

      for (const campaign of activeCampaigns) {
        expect(campaign.status).toBe('active');
      }
    });
  });

  describe('subscribe', () => {
    it('returns an unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('notifies subscribers when campaign status changes', async () => {
      const callback = vi.fn();
      service.subscribe(callback);

      const campaigns = await service.getActiveCampaigns();
      if (campaigns.length > 0) {
        await service.pauseCampaign(campaigns[0].id);
        expect(callback).toHaveBeenCalled();
      }
    });

    it('stops notifying after unsubscribe', async () => {
      const callback = vi.fn();
      const unsubscribe = service.subscribe(callback);
      unsubscribe();

      const campaigns = await service.getActiveCampaigns();
      if (campaigns.length > 0) {
        await service.pauseCampaign(campaigns[0].id);
        expect(callback).not.toHaveBeenCalled();
      }
    });
  });

  describe('pauseCampaign', () => {
    it('changes campaign status from active to queued', async () => {
      const campaigns = await service.getActiveCampaigns();

      if (campaigns.length > 0) {
        const campaignId = campaigns[0].id;
        await service.pauseCampaign(campaignId);

        const updated = await service.getCampaign(campaignId);
        expect(updated?.status).toBe('queued');
      }
    });

    it('does nothing for non-active campaigns', async () => {
      const campaigns = await service.getCampaigns();
      const queued = campaigns.find(c => c.status === 'queued');

      if (queued) {
        await service.pauseCampaign(queued.id);
        const updated = await service.getCampaign(queued.id);
        expect(updated?.status).toBe('queued');
      }
    });
  });

  describe('resumeCampaign', () => {
    it('changes campaign status from queued to active', async () => {
      // First pause an active campaign
      const campaigns = await service.getActiveCampaigns();
      if (campaigns.length > 0) {
        const campaignId = campaigns[0].id;
        await service.pauseCampaign(campaignId);

        // Then resume it
        await service.resumeCampaign(campaignId);

        const updated = await service.getCampaign(campaignId);
        expect(updated?.status).toBe('active');
      }
    });

    it('does nothing for non-queued campaigns', async () => {
      const campaigns = await service.getActiveCampaigns();

      if (campaigns.length > 0) {
        const campaignId = campaigns[0].id;
        await service.resumeCampaign(campaignId);

        const updated = await service.getCampaign(campaignId);
        expect(updated?.status).toBe('active');
      }
    });
  });

  describe('cancelCampaign', () => {
    it('changes campaign status to complete', async () => {
      const campaigns = await service.getCampaigns();
      const campaignId = campaigns[0].id;

      await service.cancelCampaign(campaignId);

      const updated = await service.getCampaign(campaignId);
      expect(updated?.status).toBe('complete');
    });
  });
});
