import { useState, useEffect, useCallback } from 'react';
import { Link2 } from 'lucide-react';
import type { CatalogEntry, IntegrationConnection, IntegrationTestResult } from '@/models';
import { cn } from '@/utils';
import { IntegrationCard } from '@/components/IntegrationCard';
import { CredentialForm as IntegrationCredentialForm } from '@/components/CredentialForm';
import type { IVolundrService } from '@/ports';
import styles from '../Settings.module.css';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const INTEGRATION_TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'issue_tracker', label: 'Issue Trackers' },
  { key: 'source_control', label: 'Source Control' },
  { key: 'messaging', label: 'Messaging' },
];

/* ------------------------------------------------------------------ */
/* IntegrationsSection                                                 */
/* ------------------------------------------------------------------ */

interface IntegrationsSectionProps {
  service: IVolundrService;
}

export function IntegrationsSection({ service }: IntegrationsSectionProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [connectingEntry, setConnectingEntry] = useState<CatalogEntry | null>(null);
  const [integrationFormError, setIntegrationFormError] = useState('');
  const [testResult, setTestResult] = useState<IntegrationTestResult | null>(null);
  const [integrationTypeFilter, setIntegrationTypeFilter] = useState('all');

  const loadIntegrations = useCallback(async () => {
    setIntegrationsLoading(true);
    try {
      const [catalogData, connectionsData] = await Promise.all([
        service.getIntegrationCatalog(),
        service.getIntegrations(),
      ]);
      setCatalog(catalogData);
      setConnections(connectionsData);
    } finally {
      setIntegrationsLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  const connectionBySlug = useCallback(
    (slug: string) => connections.find(c => c.slug === slug),
    [connections]
  );

  const handleIntegrationConnect = useCallback(
    async (entry: CatalogEntry) => {
      if (entry.auth_type === 'oauth2_authorization_code') {
        try {
          const resp = await fetch(
            `/api/v1/volundr/integrations/oauth/${entry.slug}/authorize`,
            { credentials: 'include' }
          );
          if (!resp.ok) {
            setIntegrationFormError('Failed to start OAuth flow');
            return;
          }
          const { url } = await resp.json();
          const popup = window.open(url, `oauth-${entry.slug}`, 'width=600,height=700');
          if (!popup) {
            setIntegrationFormError('Popup blocked — please allow popups for this site');
            return;
          }
          const interval = setInterval(() => {
            if (popup.closed) {
              clearInterval(interval);
              loadIntegrations();
            }
          }, 500);
        } catch (err) {
          setIntegrationFormError(err instanceof Error ? err.message : 'OAuth flow failed');
        }
        return;
      }
      setConnectingEntry(entry);
      setIntegrationFormError('');
    },
    [loadIntegrations]
  );

  const handleIntegrationDisconnect = useCallback(
    async (connectionId: string) => {
      await service.deleteIntegration(connectionId);
      await loadIntegrations();
    },
    [service, loadIntegrations]
  );

  const handleIntegrationTest = useCallback(
    async (connectionId: string) => {
      const result = await service.testIntegration(connectionId);
      setTestResult(result);
      setTimeout(() => setTestResult(null), 5000);
    },
    [service]
  );

  const inferSecretType = (integrationType: string): string => {
    if (integrationType === 'source_control') {
      return 'git_credential';
    }
    return 'api_key';
  };

  const handleIntegrationSubmit = useCallback(
    async (
      credentialName: string,
      credentials: Record<string, string>,
      config: Record<string, string>
    ) => {
      if (!connectingEntry) {
        return;
      }

      try {
        await service.createCredential({
          name: credentialName,
          secretType: inferSecretType(connectingEntry.integration_type) as import('@/models').SecretType,
          data: credentials,
        });

        await service.createIntegration({
          integrationType: connectingEntry.integration_type,
          adapter: connectingEntry.adapter,
          credentialName,
          config,
          enabled: true,
          slug: connectingEntry.slug,
        });
        setConnectingEntry(null);
        setIntegrationFormError('');
        await loadIntegrations();
      } catch (err) {
        setIntegrationFormError(err instanceof Error ? err.message : 'Failed to connect');
      }
    },
    [connectingEntry, service, loadIntegrations]
  );

  const filteredCatalog =
    integrationTypeFilter === 'all'
      ? catalog
      : catalog.filter(e => e.integration_type === integrationTypeFilter);

  return (
    <>
      <div className={styles.integrationsHeader}>
        <p className={styles.integrationsDescription}>
          Connect external services. Integrations with MCP servers are automatically injected into
          new sessions.
        </p>
      </div>

      <div className={styles.filterRow}>
        {INTEGRATION_TYPE_FILTERS.map(f => (
          <button
            key={f.key}
            className={cn(
              styles.filterChip,
              integrationTypeFilter === f.key && styles.filterChipActive
            )}
            data-active={integrationTypeFilter === f.key ? 'true' : undefined}
            onClick={() => setIntegrationTypeFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {integrationsLoading ? (
        <div className={styles.loadingSpinner}>Loading integrations...</div>
      ) : filteredCatalog.length === 0 ? (
        <div className={styles.emptyState}>
          <Link2 className={styles.emptyStateIcon} />
          <span className={styles.emptyStateText}>No integrations available</span>
        </div>
      ) : (
        <div className={styles.integrationGrid}>
          {filteredCatalog.map(entry => (
            <IntegrationCard
              key={entry.slug}
              entry={entry}
              connection={connectionBySlug(entry.slug)}
              onConnect={handleIntegrationConnect}
              onDisconnect={handleIntegrationDisconnect}
              onTest={handleIntegrationTest}
            />
          ))}
        </div>
      )}

      {connectingEntry && (
        <IntegrationCredentialForm
          entry={connectingEntry}
          onSubmit={handleIntegrationSubmit}
          onCancel={() => setConnectingEntry(null)}
          error={integrationFormError}
        />
      )}

      {testResult && (
        <div className={styles.testResult} data-success={testResult.success ? 'true' : 'false'}>
          {testResult.success
            ? `Connected to ${testResult.provider}${testResult.workspace ? ` (${testResult.workspace})` : ''}`
            : `Connection failed: ${testResult.error ?? 'unknown error'}`}
        </div>
      )}
    </>
  );
}
