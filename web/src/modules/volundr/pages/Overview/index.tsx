import { Globe, Flag, Hammer, Activity, Eye } from 'lucide-react';
import { MetricCard, CollapsibleSection as MythologySection } from '@/modules/shared';
import { OdinStatusBar } from '@/modules/volundr/components/organisms/OdinStatusBar';
import { RealmCard } from '@/modules/volundr/components/organisms/RealmCard';
import { CampaignCard } from '@/modules/volundr/components/organisms/CampaignCard';
import { ChronicleEntry } from '@/modules/volundr/components/organisms/ChronicleEntry';
import { useOdinState } from '@/modules/volundr/hooks/useOdinState';
import { useRealms } from '@/modules/volundr/hooks/useRealms';
import { useCampaigns } from '@/modules/volundr/hooks/useCampaigns';
import { useChronicle } from '@/modules/volundr/hooks/useChronicle';
import styles from './OverviewPage.module.css';

export function OverviewPage() {
  const { state: odinState, loading: odinLoading } = useOdinState();
  const { realms, loading: realmsLoading } = useRealms();
  const { activeCampaigns, loading: campaignsLoading } = useCampaigns();
  const { entries: chronicleEntries, loading: chronicleLoading } = useChronicle(6);

  const isLoading = odinLoading || realmsLoading || campaignsLoading || chronicleLoading;

  if (isLoading || !odinState) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Odin Status Bar */}
      <OdinStatusBar state={odinState} />

      <MythologySection
        storageKey="overview"
        title="Hlidskjalf — Odin's Throne"
        icon={Eye}
        accentColor="amber"
        description="From Hlidskjalf, the high seat in Valaskjálf, Odin could see all that happened across the Nine Realms. This dashboard is your Hlidskjalf—a unified view of ODIN's consciousness, the realms it watches, the campaigns it orchestrates, and the wisdom it accumulates. From here, you observe what ODIN observes."
        footerItems={[
          'ODIN: Observational Deployment Intelligence Network',
          'Ravens: Huginn (thought) & Muninn (memory)',
        ]}
      />

      {/* Metrics Row */}
      <div className={styles.metricsRow}>
        <MetricCard
          label="Realms"
          value={`${odinState.stats.realmsHealthy}/${odinState.stats.realmsTotal}`}
          subtext="healthy"
          icon={Globe}
          iconColor="cyan"
        />
        <MetricCard
          label="Campaigns"
          value={odinState.stats.activeCampaigns}
          subtext="active"
          icon={Flag}
          iconColor="emerald"
        />
        <MetricCard
          label="Einherjar"
          value={`${odinState.stats.einherjarWorking}/${odinState.stats.einherjarTotal}`}
          subtext="working"
          icon={Hammer}
          iconColor="amber"
        />
        <MetricCard
          label="Today"
          value={odinState.stats.observationsToday}
          subtext="observations"
          icon={Activity}
          iconColor="purple"
        />
      </div>

      {/* Main Content */}
      <div className={styles.mainGrid}>
        {/* Realms Section */}
        <div className={styles.realmsSection}>
          <h2 className={styles.sectionTitle}>Realms</h2>
          <div className={styles.realmsGrid}>
            {realms.slice(0, 4).map(realm => (
              <RealmCard key={realm.id} realm={realm} />
            ))}
          </div>
        </div>

        {/* Campaigns Section */}
        <div className={styles.campaignsSection}>
          <h2 className={styles.sectionTitle}>Active Campaigns</h2>
          <div className={styles.campaignsList}>
            {activeCampaigns.map(campaign => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        </div>
      </div>

      {/* Recent Chronicle */}
      <div className={styles.chronicleSection}>
        <h2 className={styles.sectionTitle}>Recent Chronicle</h2>
        <div className={styles.chronicleCard}>
          <div className={styles.chronicleEntries}>
            {chronicleEntries.map((entry, i) => (
              <ChronicleEntry key={`${entry.time}-${i}`} entry={entry} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
