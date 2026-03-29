import { useState, useEffect, useCallback } from 'react';
import type { FeatureModule, FeatureScope } from '@/modules/volundr/models';
import type { IVolundrService } from '@/modules/volundr/ports';
import { resolveIcon } from '@/modules/icons';
import { cn } from '@/utils/classnames';
import styles from './FeatureManagementSection.module.css';

interface FeatureManagementSectionProps {
  service: IVolundrService;
}

export function FeatureManagementSection({ service }: FeatureManagementSectionProps) {
  const [features, setFeatures] = useState<FeatureModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<FeatureScope | 'all'>('all');

  const loadFeatures = useCallback(async () => {
    setLoading(true);
    try {
      const data = await service.getFeatureModules();
      setFeatures(data);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadFeatures();
  }, [loadFeatures]);

  const handleToggle = useCallback(
    async (key: string, currentEnabled: boolean) => {
      setToggling(key);
      try {
        const updated = await service.toggleFeature(key, !currentEnabled);
        setFeatures(prev => prev.map(f => (f.key === key ? updated : f)));
      } finally {
        setToggling(null);
      }
    },
    [service]
  );

  const filtered = scopeFilter === 'all' ? features : features.filter(f => f.scope === scopeFilter);

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Feature Modules</h3>
        <p className={styles.subtitle}>
          Enable or disable feature modules for all users. Disabled features are hidden from
          navigation.
        </p>
      </div>

      <div className={styles.scopeTabs}>
        {(['all', 'admin', 'user'] as const).map(scope => (
          <button
            key={scope}
            type="button"
            className={cn(styles.scopeTab, scopeFilter === scope && styles.scopeTabActive)}
            onClick={() => setScopeFilter(scope)}
          >
            {scope === 'all' ? 'All' : scope === 'admin' ? 'Admin' : 'User'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.empty}>Loading features...</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>No features found.</div>
      ) : (
        <div className={styles.featureList}>
          {filtered.map(feature => {
            const Icon = resolveIcon(feature.icon);
            const isToggling = toggling === feature.key;

            return (
              <div key={feature.key} className={styles.featureCard}>
                <div className={styles.featureInfo}>
                  {Icon && <Icon className={styles.featureIcon} />}
                  <div className={styles.featureDetails}>
                    <span className={styles.featureLabel}>{feature.label}</span>
                    <div className={styles.featureMeta}>
                      <span className={styles.featureBadge}>{feature.scope}</span>
                      <span className={styles.featureBadge}>{feature.key}</span>
                      {feature.adminOnly && <span className={styles.featureBadge}>admin-only</span>}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className={cn(styles.toggle, feature.enabled && styles.toggleOn)}
                  onClick={() => handleToggle(feature.key, feature.enabled)}
                  disabled={isToggling}
                  aria-label={`Toggle ${feature.label}`}
                >
                  <span className={cn(styles.toggleKnob, feature.enabled && styles.toggleKnobOn)} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
