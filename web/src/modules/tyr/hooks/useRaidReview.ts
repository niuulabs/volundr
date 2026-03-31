import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';
import type { ConfidenceEvent } from '../models';

const api = createApiClient('/api/v1/tyr');

export interface ReviewData {
  raid_id: string;
  name: string;
  status: string;
  chronicle_summary: string | null;
  pr_url: string | null;
  ci_passed: boolean | null;
  confidence: number;
  confidence_events: ConfidenceEvent[];
}

interface RaidActionResponse {
  id: string;
  name: string;
  status: string;
  confidence: number;
}

interface UseRaidReviewResult {
  review: ReviewData | null;
  loading: boolean;
  error: string | null;
  approve: () => Promise<RaidActionResponse>;
  reject: (reason: string) => Promise<RaidActionResponse>;
  retry: () => Promise<RaidActionResponse>;
}

export function useRaidReview(raidId: string | null): UseRaidReviewResult {
  const [review, setReview] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReview = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ReviewData>(`/raids/${id}/review`);
      setReview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!raidId) return;
    fetchReview(raidId);
  }, [raidId, fetchReview]);

  const approve = useCallback(async () => {
    if (!raidId) throw new Error('No raid selected');
    return api.post<RaidActionResponse>(`/raids/${raidId}/approve`, {});
  }, [raidId]);

  const reject = useCallback(
    async (reason: string) => {
      if (!raidId) throw new Error('No raid selected');
      return api.post<RaidActionResponse>(`/raids/${raidId}/reject`, { reason });
    },
    [raidId]
  );

  const retry = useCallback(async () => {
    if (!raidId) throw new Error('No raid selected');
    return api.post<RaidActionResponse>(`/raids/${raidId}/retry`, {});
  }, [raidId]);

  return { review, loading, error, approve, reject, retry };
}
