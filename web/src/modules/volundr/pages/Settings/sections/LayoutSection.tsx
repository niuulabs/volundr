import { useState, useEffect, useCallback } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { UserFeaturePreference } from '@/modules/volundr/models';
import type { IVolundrService } from '@/modules/volundr/ports';
import { resolveIcon } from '@/modules/icons';
import { cn } from '@/utils/classnames';
import styles from './LayoutSection.module.css';

interface LayoutItem {
  key: string;
  label: string;
  icon: string;
  visible: boolean;
  sortOrder: number;
}

interface LayoutSectionProps {
  service: IVolundrService;
}

export function LayoutSection({ service }: LayoutSectionProps) {
  const [items, setItems] = useState<LayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [features, prefs] = await Promise.all([
        service.getFeatureModules('session'),
        service.getUserFeaturePreferences(),
      ]);

      const prefMap = new Map(prefs.map(p => [p.featureKey, p]));

      const merged: LayoutItem[] = features.map(f => {
        const pref = prefMap.get(f.key);
        return {
          key: f.key,
          label: f.label,
          icon: f.icon,
          visible: pref ? pref.visible : true,
          sortOrder: pref ? pref.sortOrder : f.order,
        };
      });

      merged.sort((a, b) => a.sortOrder - b.sortOrder);
      // Re-index sort orders
      merged.forEach((item, idx) => {
        item.sortOrder = idx * 10;
      });

      setItems(merged);
      setDirty(false);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleVisible = useCallback((key: string) => {
    setItems(prev =>
      prev.map(item => (item.key === key ? { ...item, visible: !item.visible } : item))
    );
    setDirty(true);
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return;
    setItems(prev => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((item, i) => ({ ...item, sortOrder: i * 10 }));
    });
    setDirty(true);
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setItems(prev => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((item, i) => ({ ...item, sortOrder: i * 10 }));
    });
    setDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const prefs: UserFeaturePreference[] = items.map(item => ({
        featureKey: item.key,
        visible: item.visible,
        sortOrder: item.sortOrder,
      }));
      await service.updateUserFeaturePreferences(prefs);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [service, items]);

  const handleReset = useCallback(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return <div className={styles.empty}>Loading layout preferences...</div>;
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h3 className={styles.title}>Layout</h3>
        <p className={styles.subtitle}>Show, hide, or reorder the panels in your session view.</p>
      </div>

      <div className={styles.featureList}>
        {items.map((item, index) => {
          const Icon = resolveIcon(item.icon);

          return (
            <div key={item.key} className={styles.featureCard}>
              <div className={styles.featureInfo}>
                {Icon && <Icon className={styles.featureIcon} />}
                <span className={styles.featureLabel}>{item.label}</span>
              </div>

              <div className={styles.featureActions}>
                <button
                  type="button"
                  className={styles.moveButton}
                  onClick={() => handleMoveUp(index)}
                  disabled={index === 0}
                  aria-label={`Move ${item.label} up`}
                >
                  <ChevronUp className={styles.moveIcon} />
                </button>
                <button
                  type="button"
                  className={styles.moveButton}
                  onClick={() => handleMoveDown(index)}
                  disabled={index === items.length - 1}
                  aria-label={`Move ${item.label} down`}
                >
                  <ChevronDown className={styles.moveIcon} />
                </button>

                <button
                  type="button"
                  className={cn(styles.toggle, item.visible && styles.toggleOn)}
                  onClick={() => handleToggleVisible(item.key)}
                  aria-label={`Toggle ${item.label} visibility`}
                >
                  <span className={cn(styles.toggleKnob, item.visible && styles.toggleKnobOn)} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {dirty && (
        <div className={styles.saveBar}>
          <button type="button" className={styles.resetButton} onClick={handleReset}>
            Reset
          </button>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Layout'}
          </button>
        </div>
      )}
    </div>
  );
}
