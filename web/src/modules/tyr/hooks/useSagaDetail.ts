import { useState, useEffect, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';

const api = createApiClient('/api/v1/tyr/sagas');

export interface SagaRaid {
  id: string;
  identifier: string;
  title: string;
  status: string;
  status_type: string;
  assignee: string | null;
  labels: string[];
  priority: number;
  priority_label: string;
  estimate: number | null;
  url: string;
}

export interface SagaPhase {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  progress: number;
  target_date: string | null;
  raids: SagaRaid[];
}

export interface SagaDetail {
  id: string;
  tracker_id: string;
  tracker_type: string;
  slug: string;
  name: string;
  description: string;
  repos: string[];
  feature_branch: string;
  status: string;
  progress: number;
  url: string;
  phases: SagaPhase[];
}

interface UseSagaDetailResult {
  detail: SagaDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSagaDetail(sagaId: string | undefined): UseSagaDetailResult {
  const [detail, setDetail] = useState<SagaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!sagaId) {
      setDetail(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await api.get<SagaDetail>(`/${sagaId}`);
      setDetail(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [sagaId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  return { detail, loading, error, refresh: fetchDetail };
}
