import { useState, useEffect, useCallback } from 'react';
import type { MimirStats, MimirConsultation } from '@/modules/volundr/models';
import { mimirService } from '@/modules/volundr/adapters';

interface UseMimirResult {
  stats: MimirStats | null;
  consultations: MimirConsultation[];
  loading: boolean;
  error: Error | null;
  getConsultation: (id: string) => Promise<MimirConsultation | null>;
  rateConsultation: (consultationId: string, useful: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useMimir(limit?: number): UseMimirResult {
  const [stats, setStats] = useState<MimirStats | null>(null);
  const [consultations, setConsultations] = useState<MimirConsultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [statsData, consultationsData] = await Promise.all([
        mimirService.getStats(),
        mimirService.getConsultations(limit),
      ]);
      setStats(statsData);
      setConsultations(consultationsData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch Mímir data'));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchData();

    const unsubscribe = mimirService.subscribe(newConsultation => {
      setConsultations(prev => {
        const updated = [newConsultation, ...prev];
        return limit ? updated.slice(0, limit) : updated;
      });
    });

    return unsubscribe;
  }, [fetchData, limit]);

  const getConsultation = useCallback(async (id: string) => {
    return mimirService.getConsultation(id);
  }, []);

  const rateConsultation = useCallback(async (consultationId: string, useful: boolean) => {
    await mimirService.rateConsultation(consultationId, useful);
    setConsultations(prev => prev.map(c => (c.id === consultationId ? { ...c, useful } : c)));
  }, []);

  return {
    stats,
    consultations,
    loading,
    error,
    getConsultation,
    rateConsultation,
    refresh: fetchData,
  };
}
