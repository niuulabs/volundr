import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMimir } from './useMimir';
import { mimirService } from '@/modules/volundr/adapters';
import type { MimirStats, MimirConsultation } from '@/modules/volundr/models';

vi.mock('@/modules/volundr/adapters', () => ({
  mimirService: {
    getStats: vi.fn(),
    getConsultations: vi.fn(),
    getConsultation: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    rateConsultation: vi.fn(),
  },
}));

const mockStats: MimirStats = {
  totalConsultations: 847,
  consultationsToday: 12,
  tokensUsedToday: 45230,
  tokensUsedMonth: 1247890,
  costToday: 0.68,
  costMonth: 18.72,
  avgResponseTime: 2.3,
  model: 'claude-sonnet-4-20250514',
};

const mockConsultations: MimirConsultation[] = [
  {
    id: 'consult-001',
    time: '10:20',
    requester: 'Odin',
    topic: 'Kubernetes HPA tuning',
    query: 'How to tune HPA for bursty traffic?',
    response: 'Consider using custom metrics...',
    tokensIn: 89,
    tokensOut: 423,
    latency: 2.1,
    useful: true,
  },
];

describe('useMimir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mimirService.getStats).mockResolvedValue(mockStats);
    vi.mocked(mimirService.getConsultations).mockResolvedValue(mockConsultations);
    vi.mocked(mimirService.getConsultation).mockResolvedValue(mockConsultations[0]);
  });

  it('should fetch stats and consultations on mount', async () => {
    const { result } = renderHook(() => useMimir());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.stats).toEqual(mockStats);
    expect(result.current.consultations).toEqual(mockConsultations);
    expect(result.current.error).toBeNull();
  });

  it('should return stats with all required numeric properties', async () => {
    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const stats = result.current.stats;
    expect(stats).not.toBeNull();

    // These properties are used with toFixed() in MimirPage
    expect(typeof stats!.costToday).toBe('number');
    expect(typeof stats!.avgResponseTime).toBe('number');
    expect(typeof stats!.tokensUsedToday).toBe('number');

    // Verify they can be formatted
    expect(stats!.costToday.toFixed(2)).toBe('0.68');
    expect(stats!.avgResponseTime.toFixed(1)).toBe('2.3');
    expect((stats!.tokensUsedToday / 1000).toFixed(1)).toBe('45.2');
  });

  it('should return consultations with correct property names', async () => {
    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const consultation = result.current.consultations[0];
    expect(consultation).toBeDefined();

    // Verify property names used in MimirPage
    expect(consultation.time).toBe('10:20');
    expect(consultation.query).toBe('How to tune HPA for bursty traffic?');
    expect(consultation.tokensIn).toBe(89);
    expect(consultation.tokensOut).toBe(423);
    expect(consultation.latency).toBe(2.1);
  });

  it('should respect limit parameter', async () => {
    const { result } = renderHook(() => useMimir(10));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mimirService.getConsultations).toHaveBeenCalledWith(10);
  });

  it('should handle fetch error', async () => {
    vi.mocked(mimirService.getStats).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Network error');
  });

  it('should subscribe to updates', async () => {
    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mimirService.subscribe).toHaveBeenCalled();
  });

  it('should get a single consultation', async () => {
    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const consultation = await result.current.getConsultation('consult-001');
    expect(consultation).toEqual(mockConsultations[0]);
    expect(mimirService.getConsultation).toHaveBeenCalledWith('consult-001');
  });

  it('should rate consultation as useful', async () => {
    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.rateConsultation('consult-001', true);
    });

    expect(mimirService.rateConsultation).toHaveBeenCalledWith('consult-001', true);
    expect(result.current.consultations[0].useful).toBe(true);
  });

  it('should only update the matching consultation when rating', async () => {
    const twoConsultations: MimirConsultation[] = [
      mockConsultations[0],
      {
        id: 'consult-002',
        time: '10:30',
        requester: 'Tyr',
        topic: 'Deploy',
        query: 'Best approach?',
        response: 'Use blue-green...',
        tokensIn: 50,
        tokensOut: 200,
        latency: 1.5,
        useful: null,
      },
    ];
    vi.mocked(mimirService.getConsultations).mockResolvedValue(twoConsultations);

    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.rateConsultation('consult-001', false);
    });

    // First consultation updated
    expect(result.current.consultations[0].useful).toBe(false);
    // Second consultation untouched
    expect(result.current.consultations[1].useful).toBeNull();
  });

  it('should rate consultation as not useful', async () => {
    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.rateConsultation('consult-001', false);
    });

    expect(mimirService.rateConsultation).toHaveBeenCalledWith('consult-001', false);
    expect(result.current.consultations[0].useful).toBe(false);
  });

  it('should refresh data', async () => {
    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(mimirService.getStats).toHaveBeenCalledTimes(2);
  });

  it('should handle non-Error rejection', async () => {
    vi.mocked(mimirService.getStats).mockRejectedValue('string error');

    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Failed to fetch Mímir data');
  });

  it('should limit consultations from subscriber updates', async () => {
    let subscriberCallback: (consultation: MimirConsultation) => void = () => {};
    vi.mocked(mimirService.subscribe).mockImplementation(cb => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useMimir(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const newConsultation: MimirConsultation = {
      id: 'consult-002',
      time: '10:30',
      requester: 'Tyr',
      topic: 'Deployment strategy',
      query: 'Best approach?',
      response: 'Use blue-green...',
      tokensIn: 50,
      tokensOut: 200,
      latency: 1.5,
      useful: null,
    };

    act(() => {
      subscriberCallback(newConsultation);
    });

    expect(result.current.consultations.length).toBeLessThanOrEqual(1);
  });

  it('should not limit consultations from subscriber when no limit', async () => {
    let subscriberCallback: (consultation: MimirConsultation) => void = () => {};
    vi.mocked(mimirService.subscribe).mockImplementation(cb => {
      subscriberCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useMimir());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const newConsultation: MimirConsultation = {
      id: 'consult-002',
      time: '10:30',
      requester: 'Tyr',
      topic: 'Deployment strategy',
      query: 'Best approach?',
      response: 'Use blue-green...',
      tokensIn: 50,
      tokensOut: 200,
      latency: 1.5,
      useful: null,
    };

    act(() => {
      subscriberCallback(newConsultation);
    });

    expect(result.current.consultations.length).toBe(mockConsultations.length + 1);
  });
});
