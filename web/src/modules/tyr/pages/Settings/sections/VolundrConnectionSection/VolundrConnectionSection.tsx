import { useState } from 'react';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';
import type { CreateIntegrationParams, ITyrIntegrationService } from '@/modules/tyr/ports';
import { INTEGRATION_TYPES, ADAPTER_PATHS, CREDENTIAL_NAMES } from '@/modules/tyr/constants';
import { useConnectionForm } from '../useConnectionForm';
import styles from '../ConnectionSection.module.css';

const DEFAULT_VOLUNDR_URL = import.meta.env.VITE_VOLUNDR_DEFAULT_URL || 'http://volundr';

interface VolundrConnectionSectionProps {
  connection: IntegrationConnection | null;
  onConnect: (params: CreateIntegrationParams) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
  service: ITyrIntegrationService;
}

export function VolundrConnectionSection({
  connection,
  onConnect,
  onDisconnect,
  service,
}: VolundrConnectionSectionProps) {
  const [url, setUrl] = useState(DEFAULT_VOLUNDR_URL);
  const [pat, setPat] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const { error, submitting, disconnecting, setError, handleDisconnect, wrapSubmit } =
    useConnectionForm(connection?.id ?? null, onDisconnect);

  const handleTest = async () => {
    if (!connection) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await service.testConnection(connection.id);
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async () => {
    if (!pat.trim()) {
      setError('PAT is required');
      return;
    }
    const result = await wrapSubmit(() =>
      onConnect({
        integrationType: INTEGRATION_TYPES.CODE_FORGE,
        adapter: ADAPTER_PATHS.VOLUNDR_HTTP,
        credentialName: CREDENTIAL_NAMES.VOLUNDR_PAT,
        credentialValue: pat,
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
          {testResult && (
            <p className={testResult.success ? styles.testSuccess : styles.error}>
              {testResult.message}
            </p>
          )}
          <div className={styles.actions}>
            <button
              className={styles.testBtn}
              onClick={handleTest}
              disabled={testing}
              type="button"
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              className={styles.disconnectBtn}
              onClick={handleDisconnect}
              disabled={disconnecting}
              type="button"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
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
