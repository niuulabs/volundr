import type { ITyrIntegrationService } from '@/modules/tyr/ports';
import { useTyrIntegrations } from '@/modules/tyr/hooks/useTyrIntegrations';
import { VolundrConnectionSection } from './sections/VolundrConnectionSection';
import { GitHubConnectionSection } from './sections/GitHubConnectionSection';
import { TelegramConnectionSection } from './sections/TelegramConnectionSection';
import styles from './TyrSettings.module.css';

interface TyrSettingsProps {
  service: ITyrIntegrationService;
}

export function TyrSettings({ service }: TyrSettingsProps) {
  const { connections, loading, error, createConnection, deleteConnection } =
    useTyrIntegrations(service);

  const volundrConnection = connections.find(c => c.integration_type === 'code_forge') ?? null;
  const githubConnection = connections.find(c => c.integration_type === 'source_control') ?? null;
  const telegramConnection = connections.find(c => c.integration_type === 'messaging') ?? null;

  if (loading) {
    return (
      <div className={styles.page}>
        <h2 className={styles.heading}>Settings</h2>
        <p className={styles.loadingText}>Loading integrations...</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Settings</h2>
      <p className={styles.subheading}>Manage your integration connections</p>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.sections}>
        <VolundrConnectionSection
          connection={volundrConnection}
          onConnect={createConnection}
          onDisconnect={deleteConnection}
        />
        <GitHubConnectionSection
          connection={githubConnection}
          onConnect={createConnection}
          onDisconnect={deleteConnection}
        />
        <TelegramConnectionSection
          connection={telegramConnection}
          service={service}
          onDisconnect={deleteConnection}
        />
      </div>
    </div>
  );
}
