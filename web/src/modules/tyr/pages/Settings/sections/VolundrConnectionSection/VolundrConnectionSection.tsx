import { useState } from 'react';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';
import { INTEGRATION_TYPES, ADAPTER_PATHS } from '@/modules/tyr/constants';
import { useConnectionForm } from '../useConnectionForm';
import styles from './VolundrConnectionSection.module.css';

interface VolundrConnectionSectionProps {
  connection: IntegrationConnection | null;
  onConnect: (params: {
    integration_type: string;
    adapter: string;
    credential_name: string;
    credential_value: string;
    config: Record<string, string>;
  }) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
}

export function VolundrConnectionSection({
  connection,
  onConnect,
  onDisconnect,
}: VolundrConnectionSectionProps) {
  const [url, setUrl] = useState('http://volundr');
  const [pat, setPat] = useState('');
  const { error, submitting, disconnecting, setError, handleDisconnect, wrapSubmit } =
    useConnectionForm(connection?.id ?? null, onDisconnect);

  const handleConnect = async () => {
    if (!pat.trim()) {
      setError('PAT is required');
      return;
    }
    const result = await wrapSubmit(() =>
      onConnect({
        integration_type: INTEGRATION_TYPES.CODE_FORGE,
        adapter: ADAPTER_PATHS.VOLUNDR_HTTP,
        credential_name: 'volundr-pat',
        credential_value: pat,
        config: { url: url.trim() },
      })
    );
    if (result !== undefined) {
      setPat('');
    }
  };

  if (connection) {
    return (
      <div className={styles.section}>
        <h3 className={styles.title}>Volundr</h3>
        <div className={styles.connected}>
          <div className={styles.statusRow}>
            <span className={styles.statusBadge} data-status="connected">
              Connected
            </span>
            <span className={styles.detail}>{connection.config.url || 'Volundr instance'}</span>
          </div>
          <p className={styles.meta}>
            Connected {new Date(connection.createdAt).toLocaleDateString()}
          </p>
          <button
            className={styles.disconnectBtn}
            onClick={handleDisconnect}
            disabled={disconnecting}
            type="button"
          >
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.title}>Volundr</h3>
      <p className={styles.description}>
        Connect your Volundr instance to enable code forge operations.
      </p>
      <div className={styles.form}>
        <label className={styles.label} htmlFor="volundr-url">
          Volundr URL
        </label>
        <input
          id="volundr-url"
          className={styles.input}
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="http://volundr"
        />
        <label className={styles.label} htmlFor="volundr-pat">
          Personal Access Token
        </label>
        <input
          id="volundr-pat"
          className={styles.input}
          type="password"
          value={pat}
          onChange={e => setPat(e.target.value)}
          placeholder="Enter your Volundr PAT"
        />
        <button
          className={styles.connectBtn}
          onClick={handleConnect}
          disabled={submitting}
          type="button"
        >
          {submitting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
