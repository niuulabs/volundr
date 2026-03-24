import { useState } from 'react';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';
import type { CreateIntegrationParams } from '@/modules/tyr/ports';
import { INTEGRATION_TYPES, ADAPTER_PATHS, CREDENTIAL_NAMES } from '@/modules/tyr/constants';
import { useConnectionForm } from '../useConnectionForm';
import styles from '../ConnectionSection.module.css';

interface GitHubConnectionSectionProps {
  connection: IntegrationConnection | null;
  onConnect: (params: CreateIntegrationParams) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
}

export function GitHubConnectionSection({
  connection,
  onConnect,
  onDisconnect,
}: GitHubConnectionSectionProps) {
  const [pat, setPat] = useState('');
  const [org, setOrg] = useState('');
  const { error, submitting, disconnecting, setError, handleDisconnect, wrapSubmit } =
    useConnectionForm(connection?.id ?? null, onDisconnect);

  const handleConnect = async () => {
    if (!pat.trim()) {
      setError('GitHub PAT is required');
      return;
    }
    const result = await wrapSubmit(() =>
      onConnect({
        integrationType: INTEGRATION_TYPES.SOURCE_CONTROL,
        adapter: ADAPTER_PATHS.GITHUB,
        credentialName: CREDENTIAL_NAMES.GITHUB_PAT,
        credentialValue: pat,
        config: org.trim() ? { org: org.trim() } : {},
      })
    );
    if (result !== undefined) {
      setPat('');
      setOrg('');
    }
  };

  if (connection) {
    return (
      <div className={styles.section}>
        <h3 className={styles.title}>GitHub</h3>
        <div className={styles.connected}>
          <div className={styles.statusRow}>
            <span className={styles.statusBadge} data-status="connected">
              Connected
            </span>
            {connection.config.org && (
              <span className={styles.detail}>org: {connection.config.org}</span>
            )}
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
      <h3 className={styles.title}>GitHub</h3>
      <p className={styles.description}>
        Connect your GitHub account with a personal access token (repo scope).
      </p>
      <div className={styles.form}>
        <label className={styles.label} htmlFor="github-pat">
          Personal Access Token
        </label>
        <input
          id="github-pat"
          className={styles.input}
          type="password"
          value={pat}
          onChange={e => setPat(e.target.value)}
          placeholder="ghp_..."
        />
        <label className={styles.label} htmlFor="github-org">
          Organisation (optional)
        </label>
        <input
          id="github-org"
          className={styles.input}
          type="text"
          value={org}
          onChange={e => setOrg(e.target.value)}
          placeholder="e.g. niuulabs"
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
