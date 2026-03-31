import type { ICampaignService } from '@/modules/volundr/ports';
import type { Campaign } from '@/modules/volundr/models';
import { mockCampaigns } from './data';

/**
 * Mock implementation of ICampaignService
 * Returns canned data for development and testing
 */
export class MockCampaignService implements ICampaignService {
  private campaigns: Campaign[] = mockCampaigns.map(c => ({ ...c }));
  private subscribers: Set<(campaigns: Campaign[]) => void> = new Set();

  async getCampaigns(): Promise<Campaign[]> {
    return this.campaigns.map(c => ({ ...c }));
  }

  async getCampaign(id: string): Promise<Campaign | null> {
    const campaign = this.campaigns.find(c => c.id === id);
    return campaign ? { ...campaign } : null;
  }

  async getActiveCampaigns(): Promise<Campaign[]> {
    return this.campaigns.filter(c => c.status === 'active').map(c => ({ ...c }));
  }

  subscribe(callback: (campaigns: Campaign[]) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    const campaign = this.campaigns.find(c => c.id === campaignId);
    if (campaign && campaign.status === 'active') {
      campaign.status = 'queued';
      this.notifySubscribers();
    }
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    const campaign = this.campaigns.find(c => c.id === campaignId);
    if (campaign && campaign.status === 'queued') {
      campaign.status = 'active';
      this.notifySubscribers();
    }
  }

  async cancelCampaign(campaignId: string): Promise<void> {
    const campaign = this.campaigns.find(c => c.id === campaignId);
    if (campaign) {
      campaign.status = 'complete';
      this.notifySubscribers();
    }
  }

  private notifySubscribers(): void {
    for (const callback of this.subscribers) {
      callback(this.campaigns.map(c => ({ ...c })));
    }
  }
}
