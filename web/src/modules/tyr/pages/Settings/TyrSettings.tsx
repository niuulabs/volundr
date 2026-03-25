import type { ITyrIntegrationService } from '@/modules/tyr/ports';
import { useTyrIntegrations } from '@/modules/tyr/hooks/useTyrIntegrations';
import { INTEGRATION_TYPES } from '@/modules/tyr/constants';
import { VolundrConnectionSection } from './sections/VolundrConnectionSection';
import styles from './TyrSettings.module.css';

interface TyrSettingsProps {
  service: ITyrIntegrationService;
}

export function TyrSettings({ service }: TyrSettingsProps) {
  const { connections, loading, error, createConnection, deleteConnection } =
    useTyrIntegrations(service);

  const volundrConnection =
    connections.find(c => c.integrationType === INTEGRATION_TYPES.CODE_FORGE) ?? null;

  if (loading) {
    return (
      <div className={styles.page}>
        <h2 className={styles.heading}>Tyr Connections</h2>
        <p className={styles.loadingText}>Loading...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Tyr Connections</h2>
      <p className={styles.subheading}>Connect Tyr to your Volundr instance for session dispatch</p>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.sections}>
        <VolundrConnectionSection
          connection={volundrConnection}
          onConnect={createConnection}
          onDisconnect={deleteConnection}
          service={service}
        />
      </div>
    </div>
  );
}
