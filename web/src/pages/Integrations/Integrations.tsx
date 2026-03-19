import { useState, useEffect, useCallback } from 'react';
import type { CatalogEntry, IntegrationConnection, IntegrationTestResult } from '@/models';
import type { IVolundrService } from '@/ports';
import { volundrService } from '@/adapters';
import { IntegrationCard } from '@/components/IntegrationCard';
import { CredentialForm } from '@/components/CredentialForm';
import { cn } from '@/utils';
import styles from './Integrations.module.css';

const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'issue_tracker', label: 'Issue Trackers' },
  { key: 'source_control', label: 'Source Control' },
  { key: 'messaging', label: 'Messaging' },
];

interface IntegrationsPageProps {
  service?: IVolundrService;
}

export function IntegrationsPage({ service = volundrService }: IntegrationsPageProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingEntry, setConnectingEntry] = useState<CatalogEntry | null>(null);
  const [formError, setFormError] = useState<string>('');
  const [testResult, setTestResult] = useState<IntegrationTestResult | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [catalogData, connectionsData] = await Promise.all([
        service.getIntegrationCatalog(),
        service.getIntegrations(),
      ]);
      setCatalog(catalogData);
      setConnections(connectionsData);
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const connectionBySlug = useCallback(
    (slug: string) => connections.find(c => c.slug === slug),
    [connections]
  );

  const handleConnect = useCallback(
    async (entry: CatalogEntry) => {
      if (entry.auth_type === 'oauth2_authorization_code') {
        try {
          const resp = await fetch(`/api/v1/volundr/integrations/oauth/${entry.slug}/authorize`, {
            credentials: 'include',
          });
          if (!resp.ok) {
            setFormError('Failed to start OAuth flow');
            return;
          }
          const { url } = await resp.json();
          const popup = window.open(url, `oauth-${entry.slug}`, 'width=600,height=700');
          if (!popup) {
            setFormError('Popup blocked — please allow popups for this site');
            return;
          }
          const interval = setInterval(() => {
            if (popup.closed) {
              clearInterval(interval);
              loadData();
            }
          }, 500);
        } catch (err) {
          setFormError(err instanceof Error ? err.message : 'OAuth flow failed');
        }
        return;
      }
      setConnectingEntry(entry);
      setFormError('');
    },
    [loadData]
  );

  const handleDisconnect = useCallback(
    async (connectionId: string) => {
      await service.deleteIntegration(connectionId);
      await loadData();
    },
    [service, loadData]
  );

  const handleTest = useCallback(
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

  const handleSubmit = useCallback(
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
          secretType: inferSecretType(
            connectingEntry.integration_type
          ) as import('@/models').SecretType,
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
        setFormError('');
        await loadData();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : 'Failed to connect');
      }
    },
    [connectingEntry, service, loadData]
  );

  const filteredCatalog =
    typeFilter === 'all' ? catalog : catalog.filter(e => e.integration_type === typeFilter);

  if (loading) {
    return <div className={styles.loading}>Loading integrations...</div>;
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Integrations</h1>
        <p className={styles.subtitle}>
          Connect external services. Integrations with MCP servers are automatically injected into
          new sessions.
        </p>
      </div>

      <div className={styles.filterRow}>
        {TYPE_FILTERS.map(f => (
          <button
            key={f.key}
            className={cn(typeFilter === f.key ? styles.filterButtonActive : styles.filterButton)}
            onClick={() => setTypeFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={styles.section}>
        {filteredCatalog.length === 0 ? (
          <div className={styles.empty}>No integrations available</div>
        ) : (
          <div className={styles.grid}>
            {filteredCatalog.map(entry => (
              <IntegrationCard
                key={entry.slug}
                entry={entry}
                connection={connectionBySlug(entry.slug)}
                onConnect={handleConnect}
                onDisconnect={handleDisconnect}
                onTest={handleTest}
              />
            ))}
          </div>
        )}
      </div>

      {connectingEntry && (
        <CredentialForm
          entry={connectingEntry}
          onSubmit={handleSubmit}
          onCancel={() => setConnectingEntry(null)}
          error={formError}
        />
      )}

      {testResult && (
        <div className={styles.testResult} data-success={testResult.success ? 'true' : 'false'}>
          {testResult.success
            ? `Connected to ${testResult.provider}${testResult.workspace ? ` (${testResult.workspace})` : ''}`
            : `Connection failed: ${testResult.error ?? 'unknown error'}`}
        </div>
      )}
    </div>
  );
}
