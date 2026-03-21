import { useNavigate } from 'react-router-dom';
import { Globe } from 'lucide-react';
import { CollapsibleSection as MythologySection } from '@/modules/shared';
import { RealmCard } from '@/modules/volundr/components/organisms/RealmCard';
import { useRealms } from '@/modules/volundr/hooks/useRealms';
import styles from './RealmsPage.module.css';

export function RealmsPage() {
  const { realms, loading } = useRealms();
  const navigate = useNavigate();

  const healthyCount = realms.filter(r => r.status === 'healthy').length;
  const warningCount = realms.filter(r => r.status === 'warning').length;

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
          <div className={styles.titleRow}>
            <div className={styles.iconContainer}>
              <Globe className={styles.icon} />
            </div>
            <div>
              <h1 className={styles.title}>Realms</h1>
              <p className={styles.subtitle}>Infrastructure domains under ODIN's watch</p>
            </div>
          </div>
        </div>
        <div className={styles.stats}>
          <span className={styles.statsText}>
            {healthyCount} healthy · {warningCount} warning
          </span>
        </div>
      </div>

      <MythologySection
        storageKey="realms"
        title="The Nine Realms"
        icon={Globe}
        accentColor="cyan"
        description="In Norse cosmology, the Nine Realms are the worlds connected by Yggdrasil, the world tree. Each realm in ODIN represents an infrastructure domain&mdash;from Valhalla's GPU clusters to Vanaheim's production servers. The Valkyries watch over these realms, observing their health and reporting anomalies to ODIN."
        footerItems={[
          'Watched by: Valkyries (Brynhildr, Sigrdr\u00edfa, Mist, Svipul, Hildr, G\u00f6ndul)',
          'Connected via: Yggdrasil (infrastructure bus)',
        ]}
      />

      <div className={styles.grid}>
        {realms.map(realm => (
          <RealmCard
            key={realm.id}
            realm={realm}
            variant="detailed"
            onClick={() => navigate(`/realms/${realm.id}`)}
          />
        ))}
      </div>
    </div>
  );
}
