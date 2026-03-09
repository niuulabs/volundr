import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useCampaigns } from './useCampaigns';
import { campaignService } from '@/adapters';
import type { Campaign } from '@/models';

vi.mock('@/adapters', () => ({
  campaignService: {
    getCampaigns: vi.fn(),
    getCampaign: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    pauseCampaign: vi.fn(),
    resumeCampaign: vi.fn(),
    cancelCampaign: vi.fn(),
  },
}));

const mockCampaigns: Campaign[] = [
  {
    id: 'campaign-001',
    name: 'Storage Health Observer',
    description: 'Add storage health monitoring',
    status: 'active',
    progress: 67,
    confidence: 0.82,
    mergeThreshold: 0.85,
    phases: [],
    einherjar: [],
    started: '2024-01-23T08:13:00Z',
    eta: '~45m',
    repoAccess: [],
  },
  {
    id: 'campaign-002',
    name: 'Queued Campaign',
    description: 'A queued campaign',
    status: 'queued',
    progress: 0,
    confidence: null,
    mergeThreshold: 0.75,
    phases: [],
    einherjar: [],
    started: null,
    eta: 'Awaiting resources',
    repoAccess: [],
  },
];

describe('useCampaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(campaignService.getCampaigns).mockResolvedValue(mockCampaigns);
    vi.mocked(campaignService.getCampaign).mockResolvedValue(mockCampaigns[0]);
  });

  it('should fetch campaigns on mount', async () => {
    const { result } = renderHook(() => useCampaigns());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.campaigns).toEqual(mockCampaigns);
    expect(result.current.error).toBeNull();
  });

  it('should filter active campaigns', async () => {
    const { result } = renderHook(() => useCampaigns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.activeCampaigns).toHaveLength(1);
    expect(result.current.activeCampaigns[0].id).toBe('campaign-001');
  });

  it('should handle fetch error', async () => {
    vi.mocked(campaignService.getCampaigns).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useCampaigns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Network error');
  });

  it('should subscribe to updates', async () => {
    const { result } = renderHook(() => useCampaigns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(campaignService.subscribe).toHaveBeenCalled();
  });

  it('should get a single campaign', async () => {
    const { result } = renderHook(() => useCampaigns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const campaign = await result.current.getCampaign('campaign-001');
    expect(campaign).toEqual(mockCampaigns[0]);
  });

  it('should pause campaign', async () => {
    const { result } = renderHook(() => useCampaigns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.pauseCampaign('campaign-001');
    });

    expect(campaignService.pauseCampaign).toHaveBeenCalledWith('campaign-001');
    expect(result.current.campaigns[0].status).toBe('queued');
  });

  it('should resume campaign', async () => {
    const { result } = renderHook(() => useCampaigns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.resumeCampaign('campaign-002');
    });

    expect(campaignService.resumeCampaign).toHaveBeenCalledWith('campaign-002');
    expect(result.current.campaigns[1].status).toBe('active');
  });

  it('should cancel campaign', async () => {
    const { result } = renderHook(() => useCampaigns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.cancelCampaign('campaign-001');
    });

    expect(campaignService.cancelCampaign).toHaveBeenCalledWith('campaign-001');
    expect(result.current.campaigns).toHaveLength(1);
  });

  it('should refresh campaigns', async () => {
    const { result } = renderHook(() => useCampaigns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(campaignService.getCampaigns).toHaveBeenCalledTimes(2);
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(campaignService.getCampaigns).mockRejectedValue('string error');

    const { result } = renderHook(() => useCampaigns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Failed to fetch campaigns');
  });

  it('should update campaigns from subscriber', async () => {
    let subscriberCallback: (campaigns: Campaign[]) => void = () => {};
    vi.mocked(campaignService.subscribe).mockImplementation(cb => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useCampaigns());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const updatedCampaigns = [{ ...mockCampaigns[0], status: 'completed' as const }];

    act(() => {
      subscriberCallback(updatedCampaigns);
    });

    expect(result.current.campaigns[0].status).toBe('completed');
  });
});
