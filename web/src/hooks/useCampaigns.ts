import { useState, useEffect, useCallback } from 'react';
import type { Campaign } from '@/models';
import { campaignService } from '@/adapters';

interface UseCampaignsResult {
  campaigns: Campaign[];
  activeCampaigns: Campaign[];
  loading: boolean;
  error: Error | null;
  getCampaign: (id: string) => Promise<Campaign | null>;
  pauseCampaign: (campaignId: string) => Promise<void>;
  resumeCampaign: (campaignId: string) => Promise<void>;
  cancelCampaign: (campaignId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useCampaigns(): UseCampaignsResult {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await campaignService.getCampaigns();
      setCampaigns(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch campaigns'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();

    const unsubscribe = campaignService.subscribe(newCampaigns => {
      setCampaigns(newCampaigns);
    });

    return unsubscribe;
  }, [fetchCampaigns]);

  const activeCampaigns = campaigns.filter(c => c.status === 'active');

  const getCampaign = useCallback(async (id: string) => {
    return campaignService.getCampaign(id);
  }, []);

  const pauseCampaign = useCallback(async (campaignId: string) => {
    await campaignService.pauseCampaign(campaignId);
    setCampaigns(prev =>
      prev.map(c => (c.id === campaignId ? { ...c, status: 'queued' as const } : c))
    );
  }, []);

  const resumeCampaign = useCallback(async (campaignId: string) => {
    await campaignService.resumeCampaign(campaignId);
    setCampaigns(prev =>
      prev.map(c => (c.id === campaignId ? { ...c, status: 'active' as const } : c))
    );
  }, []);

  const cancelCampaign = useCallback(async (campaignId: string) => {
    await campaignService.cancelCampaign(campaignId);
    setCampaigns(prev => prev.filter(c => c.id !== campaignId));
  }, []);

  return {
    campaigns,
    activeCampaigns,
    loading,
    error,
    getCampaign,
    pauseCampaign,
    resumeCampaign,
    cancelCampaign,
    refresh: fetchCampaigns,
  };
}
