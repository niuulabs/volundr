import { ScrollText } from 'lucide-react';
import { FilterTabs, ChronicleEntry, MythologySection } from '@/components';
import { useChronicle } from '@/hooks';
import type { ChronicleType } from '@/models';
import styles from './ChroniclePage.module.css';

const FILTER_OPTIONS = ['all', 'think', 'observe', 'decide', 'act', 'complete', 'merge'];

export function ChroniclePage() {
  const { entries, filter, setFilter, loading } = useChronicle();

  const handleFilterChange = (newFilter: string) => {
    setFilter(newFilter as ChronicleType | 'all');
  };

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <h1 className={styles.title}>Chronicle</h1>
          <p className={styles.subtitle}>
            Complete log of ODIN's observations, thoughts, and actions
          </p>
        </div>
        <FilterTabs options={FILTER_OPTIONS} value={filter} onChange={handleFilterChange} />
      </div>

      <MythologySection
        storageKey="chronicle"
        title="The Saga of ODIN"
        icon={ScrollText}
        accentColor="purple"
        description="In Norse tradition, sagas were oral histories passed down through generations—records of great deeds, decisions, and transformations. The Chronicle is ODIN's saga: every observation made by Huginn, every memory stored by Muninn, every decision reached, and every action taken. This living record enables learning and accountability."
        footerItems={[
          'Events: Observations, thoughts, decisions, actions',
          'Sources: Huginn (events), Muninn (memory), ODIN (decisions)',
        ]}
      />

      <div className={styles.entryList}>
        <div className={styles.entries}>
          {entries.map((entry, i) => (
            <ChronicleEntry key={`${entry.time}-${i}`} entry={entry} />
          ))}
        </div>
      </div>

      {entries.length === 0 && (
        <div className={styles.empty}>
          <ScrollText className={styles.emptyIcon} />
          <p className={styles.emptyText}>No entries match the filter</p>
        </div>
      )}
    </div>
  );
}
