import type { Campaign } from '@/modules/volundr/models';

/**
 * Port interface for Campaign service
 * Manages multi-repo coordinated work campaigns
 */
export interface ICampaignService {
  /**
   * Get all campaigns
   */
  getCampaigns(): Promise<Campaign[]>;

  /**
   * Get a specific campaign by ID
   */
  getCampaign(id: string): Promise<Campaign | null>;

  /**
   * Get active campaigns only
   */
  getActiveCampaigns(): Promise<Campaign[]>;

  /**
   * Subscribe to campaign updates
   * @returns Unsubscribe function
   */
  subscribe(callback: (campaigns: Campaign[]) => void): () => void;

  /**
   * Pause a campaign
   */
  pauseCampaign(campaignId: string): Promise<void>;

  /**
   * Resume a paused campaign
   */
  resumeCampaign(campaignId: string): Promise<void>;

  /**
   * Cancel a campaign
   */
  cancelCampaign(campaignId: string): Promise<void>;
}
