import { useState } from 'react';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import type { IntegrationConnection } from '@/modules/shared/models/integration.model';
import type { CreateIntegrationParams, ITyrIntegrationService } from '@/modules/tyr/ports';
import { INTEGRATION_TYPES, ADAPTER_PATHS, CREDENTIAL_NAMES } from '@/modules/tyr/constants';
import { useConnectionForm } from '../useConnectionForm';
import styles from './VolundrConnectionSection.module.css';

const DEFAULT_VOLUNDR_URL = import.meta.env.VITE_VOLUNDR_DEFAULT_URL || 'http://volundr';

interface VolundrConnectionSectionProps {
  connections: IntegrationConnection[];
  onConnect: (params: CreateIntegrationParams) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
  service: ITyrIntegrationService;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
    await wrapSubmit(async () => {
      const config: Record<string, string> = { url: url.trim() };
      if (clusterName.trim()) {
        config.name = clusterName.trim();
      }
      await onConnect({
        integrationType: INTEGRATION_TYPES.CODE_FORGE,
        adapter: ADAPTER_PATHS.VOLUNDR_HTTP,
        credentialName: CREDENTIAL_NAMES.VOLUNDR_PAT,
        credentialValue: pat,
        config,
      });
      setPat('');
      setClusterName('');
      setUrl(DEFAULT_VOLUNDR_URL);
      setShowForm(false);
    });
  };

  return (
    <>
      {/* Add button — top right, aligned with parent page heading */}
      <div className={styles.contentHeader}>
        <div />
        <button type="button" className={styles.addButton} onClick={() => setShowForm(true)}>
          <Plus className={styles.addButtonIcon} />
          Add Cluster
        </button>
      </div>

      {/* Empty state */}
      {connections.length === 0 && !showForm && (
        <div className={styles.emptyState}>
          <span className={styles.emptyText}>No clusters connected</span>
        </div>
      )}

      {/* Cluster grid — same card pattern as credentials */}
      {connections.length > 0 && (
        <div className={styles.grid}>
          {connections.map(conn => (
            <ClusterCard
              key={conn.id}
              connection={conn}
              onDisconnect={onDisconnect}
              service={service}
            />
          ))}
        </div>
      )}

      {/* Add form overlay — matches credential form pattern */}
      {showForm && (
        <div className={styles.formOverlay}>
          <div className={styles.formPanel}>
            <div className={styles.formHeader}>
              <span className={styles.formTitle}>Add Volundr Cluster</span>
              <button type="button" className={styles.formClose} onClick={() => setShowForm(false)}>
                {'\u2715'}
              </button>
            </div>
            <div className={styles.formBody}>
              <div className={styles.formField}>
                <label className={styles.formLabel}>Cluster Name</label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={clusterName}
                  onChange={e => setClusterName(e.target.value)}
                  placeholder="e.g. production, staging"
                />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>
                  Volundr URL <span className={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder="https://volundr.example.com"
                />
              </div>
              <div className={styles.formField}>
                <label className={styles.formLabel}>
                  Personal Access Token <span className={styles.required}>*</span>
                </label>
                <input
                  type="password"
                  className={styles.formInput}
                  value={pat}
                  onChange={e => setPat(e.target.value)}
                  placeholder="Paste your PAT"
                />
              </div>
              {error && <div className={styles.formError}>{error}</div>}
            </div>
            <div className={styles.formFooter}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.submitButton}
                disabled={!pat.trim() || submitting}
                onClick={handleConnect}
              >
                {submitting ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Cluster Card ── */

function ClusterCard({
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

  const name = connection.config.name || connection.slug || connection.id;
  const url = connection.config.url || 'Volundr instance';

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await service.testConnection(connection.id);
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardInfo}>
        <span className={styles.cardName}>{name}</span>
        <div className={styles.cardMeta}>
          <span className={styles.statusBadge} data-status="connected">
            Connected
          </span>
          <span>{url}</span>
          <span>{formatDate(connection.createdAt)}</span>
        </div>
        {testResult && (
          <span className={testResult.success ? styles.testSuccess : styles.testError}>
            {testResult.message}
          </span>
        )}
        {error && <span className={styles.testError}>{error}</span>}
      </div>
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={handleTest}
          disabled={testing}
          title="Test connection"
        >
          <RefreshCw className={styles.iconButtonIcon} data-spinning={testing || undefined} />
        </button>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={handleDisconnect}
          disabled={disconnecting}
          title="Disconnect"
        >
          <Trash2 className={styles.deleteButtonIcon} />
        </button>
      </div>
    </div>
  );
}
