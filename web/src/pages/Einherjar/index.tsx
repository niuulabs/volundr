import { Hammer } from 'lucide-react';
import { EinherjarCard, MythologySection } from '@/components';
import { useEinherjar, useCampaigns } from '@/hooks';
import styles from './EinherjarPage.module.css';

export function EinherjarPage() {
  const { workers, loading: workersLoading } = useEinherjar();
  const { campaigns, loading: campaignsLoading } = useCampaigns();

  const isLoading = workersLoading || campaignsLoading;

  const workingCount = workers.filter(e => e.status === 'working').length;
  const idleCount = workers.filter(e => e.status === 'idle').length;

  // Create a map of campaign IDs to names for display
  const campaignNames = new Map(campaigns.map(c => [c.id, c.name]));

  if (isLoading) {
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
          <div className={styles.titleRow}>
            <div className={styles.iconContainer}>
              <Hammer className={styles.icon} />
            </div>
            <div>
              <h1 className={styles.title}>Einherjar</h1>
              <p className={styles.subtitle}>Coding agents executing campaign tasks</p>
            </div>
          </div>
        </div>
        <div className={styles.stats}>
          <span className={styles.statsText}>
            {workingCount} working · {idleCount} idle
          </span>
        </div>
      </div>

      <MythologySection
        storageKey="einherjar"
        title="The Chosen Warriors"
        icon={Hammer}
        accentColor="amber"
        description="The Einherjar were warriors who died gloriously in battle and were brought to Valhalla by the Valkyries. In ODIN, the Einherjar are autonomous coding agents—each one capable of reading code, writing patches, running tests, and submitting PRs. They work tirelessly on campaign tasks, guided by Tyr's strategic planning."
        footerItems={[
          'Capabilities: Code analysis, patch generation, test execution',
          'Guided by: Tyr (campaign planner)',
        ]}
      />

      <div className={styles.grid}>
        {workers.map(ein => (
          <EinherjarCard
            key={ein.id}
            einherjar={ein}
            campaignName={ein.campaign ? campaignNames.get(ein.campaign) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
