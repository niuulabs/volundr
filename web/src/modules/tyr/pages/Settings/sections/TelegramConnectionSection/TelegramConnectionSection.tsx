import { useState, useCallback } from 'react';
import type { TyrIntegrationConnection, ITyrIntegrationService } from '@/modules/tyr/ports';
import { useConnectionForm } from '../useConnectionForm';
import styles from './TelegramConnectionSection.module.css';

interface TelegramConnectionSectionProps {
  connection: TyrIntegrationConnection | null;
  service: ITyrIntegrationService;
  onDisconnect: (id: string) => Promise<void>;
}

export function TelegramConnectionSection({
  connection,
  service,
  onDisconnect,
}: TelegramConnectionSectionProps) {
  const [deeplink, setDeeplink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { error, disconnecting, setError, handleDisconnect } =
    useConnectionForm(connection?.id ?? null, onDisconnect);

  const handleGenerateLink = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await service.getTelegramSetup();
      setDeeplink(result.deeplink);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate link');
    } finally {
      setLoading(false);
    }
  }, [service, setError]);

  if (connection) {
    return (
      <div className={styles.section}>
        <h3 className={styles.title}>Telegram</h3>
        <div className={styles.connected}>
          <div className={styles.statusRow}>
            <span className={styles.statusBadge} data-status="connected">
              Connected
            </span>
          </div>
          <p className={styles.meta}>
            Linked {new Date(connection.created_at).toLocaleDateString()}
          </p>
          <button
            className={styles.disconnectBtn}
            onClick={handleDisconnect}
            disabled={disconnecting}
            type="button"
          >
            {disconnecting ? 'Disconnecting...' : 'Unlink'}
          </button>
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.title}>Telegram</h3>
      <p className={styles.description}>
        Link your Telegram account to receive notifications from Tyr.
      </p>
      {deeplink ? (
        <div className={styles.linkContainer}>
          <a href={deeplink} target="_blank" rel="noopener noreferrer" className={styles.deeplink}>
            Open in Telegram
          </a>
          <p className={styles.hint}>
            Click the link above, then press Start in the Telegram bot chat.
          </p>
        </div>
      ) : (
        <button
          className={styles.connectBtn}
          onClick={handleGenerateLink}
          disabled={loading}
          type="button"
        >
          {loading ? 'Generating...' : 'Generate Link'}
        </button>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
