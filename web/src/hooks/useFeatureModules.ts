import { useState, useEffect, useCallback, useMemo, lazy } from 'react';
import type { ComponentType } from 'react';
import type { IVolundrService } from '@/ports';
import type { FeatureScope, FeatureModule, UserFeaturePreference } from '@/models';
import type { SectionDefinition } from '@/components/SectionLayout';
import { getModule } from '@/modules/registry';
import { resolveIcon } from '@/modules/icons';

// Cache lazy components so React.lazy is only called once per module key
const lazyCache = new Map<string, ComponentType<{ service: IVolundrService }>>();

function getLazyComponent(key: string): ComponentType<{ service: IVolundrService }> | undefined {
  if (lazyCache.has(key)) {
    return lazyCache.get(key)!;
  }

  const entry = getModule(key);
  if (!entry) return undefined;

  const LazyComponent = lazy(entry.load);
  lazyCache.set(key, LazyComponent);
  return LazyComponent;
}

interface UseFeatureModulesResult {
  sections: SectionDefinition[];
  loading: boolean;
  error: string | null;
  features: FeatureModule[];
  preferences: UserFeaturePreference[];
  refetch: () => void;
}

/**
 * Fetches features + user preferences from the backend, resolves components
 * from the module registry, and returns ordered SectionDefinitions ready
 * for SectionLayout.
 */
export function useFeatureModules(
  scope: FeatureScope,
  service: IVolundrService
): UseFeatureModulesResult {
  const [features, setFeatures] = useState<FeatureModule[]>([]);
  const [preferences, setPreferences] = useState<UserFeaturePreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [feats, prefs] = await Promise.all([
        service.getFeatureModules(scope),
        service.getUserFeaturePreferences(),
      ]);
      setFeatures(feats);
      setPreferences(prefs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load features');
    } finally {
      setLoading(false);
    }
  }, [scope, service]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Build sections by merging features + user prefs + module registry
  const sections = useMemo(() => buildSections(features, preferences), [features, preferences]);

  return { sections, loading, error, features, preferences, refetch: fetchData };
}

function buildSections(
  features: FeatureModule[],
  preferences: UserFeaturePreference[]
): SectionDefinition[] {
  const prefMap = new Map(preferences.map(p => [p.featureKey, p]));

  // Filter to enabled + visible features
  const visible = features.filter(f => {
    if (!f.enabled) return false;
    const pref = prefMap.get(f.key);
    if (pref && !pref.visible) return false;
    return true;
  });

  // Sort: user sort_order takes priority, then config order
  visible.sort((a, b) => {
    const prefA = prefMap.get(a.key);
    const prefB = prefMap.get(b.key);
    const orderA = prefA !== undefined ? prefA.sortOrder : a.order;
    const orderB = prefB !== undefined ? prefB.sortOrder : b.order;
    return orderA - orderB;
  });

  // Map to SectionDefinitions
  const sections: SectionDefinition[] = [];
  for (const feat of visible) {
    const component = getLazyComponent(feat.key);
    if (!component) continue;

    const entry = getModule(feat.key);
    const icon = entry?.icon ?? resolveIcon(feat.icon);
    if (!icon) continue;

    sections.push({
      key: feat.key,
      label: feat.label,
      icon,
      component,
    });
  }

  return sections;
}
