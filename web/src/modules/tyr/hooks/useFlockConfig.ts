import { useState, useCallback } from 'react';
import { createApiClient } from '@/modules/shared/api/client';

const api = createApiClient('/api/v1/tyr/flock');

export interface FlockConfig {
  flock_enabled: boolean;
  flock_default_personas: Array<{ name: string; llm: Record<string, unknown> }>;
  flock_llm_config: Record<string, unknown>;
  flock_sleipnir_publish_urls: string[];
}

interface PatchFlockConfig {
  flock_enabled?: boolean;
  flock_default_personas?: string[];
  flock_llm_config?: Record<string, unknown>;
  flock_sleipnir_publish_urls?: string[];
}

interface UseFlockConfigResult {
  updating: boolean;
  error: string | null;
  setFlockEnabled: (enabled: boolean) => Promise<void>;
  setDefaultPersonas: (personas: string[]) => Promise<void>;
  setLlmConfig: (config: Record<string, unknown>) => Promise<void>;
  setSleipnirUrls: (urls: string[]) => Promise<void>;
}

export function useFlockConfig(): UseFlockConfigResult {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = useCallback(async (updates: PatchFlockConfig): Promise<void> => {
    setUpdating(true);
    setError(null);
    try {
      await api.patch<FlockConfig>('/config', updates);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdating(false);
    }
  }, []);

  const setFlockEnabled = useCallback(
    (enabled: boolean) => patch({ flock_enabled: enabled }),
    [patch]
  );

  const setDefaultPersonas = useCallback(
    (personas: string[]) => patch({ flock_default_personas: personas }),
    [patch]
  );

  const setLlmConfig = useCallback(
    (config: Record<string, unknown>) => patch({ flock_llm_config: config }),
    [patch]
  );

  const setSleipnirUrls = useCallback(
    (urls: string[]) => patch({ flock_sleipnir_publish_urls: urls }),
    [patch]
  );

  return { updating, error, setFlockEnabled, setDefaultPersonas, setLlmConfig, setSleipnirUrls };
}
