import type { CatalogEntry, IntegrationConnection } from '@/modules/volundr/models';
import styles from './IntegrationCard.module.css';

const TYPE_LABELS: Record<string, string> = {
  issue_tracker: 'Issue Tracker',
  source_control: 'Source Control',
  messaging: 'Messaging',
};

interface CatalogCardProps {
  entry: CatalogEntry;
  connection?: IntegrationConnection;
  onConnect: (entry: CatalogEntry) => void;
  onDisconnect?: (connectionId: string) => void;
  onTest?: (connectionId: string) => void;
}

export function IntegrationCard({
  entry,
  connection,
  onConnect,
  onDisconnect,
  onTest,
}: CatalogCardProps) {
  const isConnected = connection != null && connection.enabled;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <span className={styles.name}>{entry.name}</span>
          <span className={styles.badge} data-type={entry.integration_type}>
            {TYPE_LABELS[entry.integration_type] ?? entry.integration_type}
          </span>
          {entry.mcp_server && <span className={styles.mcpBadge}>MCP</span>}
        </div>
      </div>

      {entry.description && <div className={styles.description}>{entry.description}</div>}

      {connection && (
        <div className={styles.status}>
          <span
            className={styles.statusDot}
            data-status={isConnected ? 'connected' : 'disconnected'}
          />
          <span className={styles.statusLabel}>{isConnected ? 'Connected' : 'Disabled'}</span>
        </div>
      )}

      {connection && (
        <div className={styles.credentialInfo}>Credential: {connection.credentialName}</div>
      )}

      <div className={styles.actions}>
        {!connection && (
          <button className={styles.connectButton} onClick={() => onConnect(entry)}>
            Connect
          </button>
        )}
        {connection && onTest && (
          <button className={styles.actionButton} onClick={() => onTest(connection.id)}>
            Test
          </button>
        )}
        {connection && onDisconnect && (
          <button className={styles.deleteButton} onClick={() => onDisconnect(connection.id)}>
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
