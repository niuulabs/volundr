import { useState } from 'react';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';
import type { CreateIntegrationParams, ITyrIntegrationService } from '@/modules/tyr/ports';
import { INTEGRATION_TYPES, ADAPTER_PATHS, CREDENTIAL_NAMES } from '@/modules/tyr/constants';
import { useConnectionForm } from '../useConnectionForm';
import styles from '../ConnectionSection.module.css';

const DEFAULT_VOLUNDR_URL = import.meta.env.VITE_VOLUNDR_DEFAULT_URL || 'http://volundr';

interface VolundrConnectionSectionProps {
  connections: IntegrationConnection[];
  onConnect: (params: CreateIntegrationParams) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
  service: ITyrIntegrationService;
}

function ConnectedCluster({
  connection,
  onDisconnect,
  service,
}: {
  connection: IntegrationConnection;
  onDisconnect: (id: string) => Promise<void>;
  service: ITyrIntegrationService;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const { error, disconnecting, handleDisconnect } = useConnectionForm(connection.id, onDisconnect);

  const clusterName = connection.config.name || connection.slug || connection.id;

  const handleTest = async () => {
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

  return (
    <div className={styles.connected}>
      <div className={styles.statusRow}>
        <span className={styles.statusBadge} data-status="connected">
          Connected
        </span>
        <span className={styles.detail}>
          {clusterName} — {connection.config.url || 'Volundr instance'}
        </span>
      </div>
      <p className={styles.meta}>Connected {new Date(connection.createdAt).toLocaleDateString()}</p>
      {testResult && (
        <p className={testResult.success ? styles.testSuccess : styles.error}>
          {testResult.message}
        </p>
      )}
      <div className={styles.actions}>
        <button className={styles.testBtn} onClick={handleTest} disabled={testing} type="button">
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
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}

export function VolundrConnectionSection({
  connections,
  onConnect,
  onDisconnect,
  service,
}: VolundrConnectionSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState(DEFAULT_VOLUNDR_URL);
  const [clusterName, setClusterName] = useState('');
  const [pat, setPat] = useState('');
  const { error, submitting, setError, wrapSubmit } = useConnectionForm(null, onDisconnect);

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
        config: {
          url: url.trim(),
          ...(clusterName.trim() ? { name: clusterName.trim() } : {}),
        },
      })
    );
    if (result !== undefined) {
      setPat('');
      setClusterName('');
      setUrl(DEFAULT_VOLUNDR_URL);
      setShowForm(false);
    }
  };

  const hasConnections = connections.length > 0;
  const showAddForm = showForm || !hasConnections;

  return (
    <div className={styles.section}>
      <h3 className={styles.title}>Volundr Clusters</h3>
      {!hasConnections && (
        <p className={styles.description}>
          Connect your Volundr instances to enable code forge operations.
        </p>
      )}
      {connections.map(conn => (
        <ConnectedCluster
          key={conn.id}
          connection={conn}
          onDisconnect={onDisconnect}
          service={service}
        />
      ))}
      {hasConnections && !showForm && (
        <button className={styles.connectBtn} onClick={() => setShowForm(true)} type="button">
          Add another cluster
        </button>
      )}
      {showAddForm && (
        <div className={styles.form}>
          <label className={styles.label} htmlFor="volundr-name">
            Cluster Name (optional)
          </label>
          <input
            id="volundr-name"
            className={styles.input}
            type="text"
            value={clusterName}
            onChange={e => setClusterName(e.target.value)}
            placeholder="e.g. production, staging"
          />
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
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
