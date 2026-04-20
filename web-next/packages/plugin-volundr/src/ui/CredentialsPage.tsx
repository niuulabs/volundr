import { Table, StateDot } from '@niuulabs/ui';
import type { TableColumn } from '@niuulabs/ui';
import { useService } from '@niuulabs/plugin-sdk';
import { useQuery } from '@tanstack/react-query';
import type { IVolundrService } from '../ports/IVolundrService';
import type { StoredCredential } from '../models/volundr.model';

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COLUMNS: TableColumn<StoredCredential>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (row) => (
      <div className="niuu-flex niuu-items-center niuu-gap-2">
        <span className="niuu-inline-block niuu-h-2 niuu-w-2 niuu-rounded-full niuu-bg-brand" />
        <span className="niuu-font-mono niuu-text-sm niuu-text-text-primary">{row.name}</span>
      </div>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    render: (row) => (
      <span className="niuu-font-mono niuu-text-xs niuu-text-text-secondary">
        {row.secretType.replace(/_/g, ' ')}
      </span>
    ),
  },
  {
    key: 'keys',
    header: 'Keys',
    render: (row) => (
      <div className="niuu-flex niuu-flex-wrap niuu-gap-1">
        {row.keys.map((k) => (
          <code
            key={k}
            className="niuu-rounded niuu-bg-bg-tertiary niuu-px-1.5 niuu-py-0.5 niuu-font-mono niuu-text-xs niuu-text-text-secondary"
          >
            {k}
          </code>
        ))}
      </div>
    ),
  },
  {
    key: 'updated',
    header: 'Updated',
    render: (row) => (
      <span className="niuu-font-mono niuu-text-xs niuu-text-text-faint">{row.updatedAt}</span>
    ),
  },
  {
    key: 'actions',
    header: '',
    render: () => (
      <div className="niuu-flex niuu-items-center niuu-gap-1">
        <button
          className="niuu-rounded niuu-p-1 niuu-text-text-muted hover:niuu-text-text-primary"
          title="copy"
          aria-label="copy"
        >
          \u2398
        </button>
        <button
          className="niuu-rounded niuu-p-1 niuu-text-text-muted hover:niuu-text-critical"
          title="delete"
          aria-label="delete credential"
        >
          \u2715
        </button>
      </div>
    ),
  },
];

// ---------------------------------------------------------------------------
// CredentialsPage
// ---------------------------------------------------------------------------

export function CredentialsPage() {
  const service = useService<IVolundrService>('volundr');
  const credentials = useQuery({
    queryKey: ['volundr', 'credentials'],
    queryFn: () => service.getCredentials(),
  });

  return (
    <div className="niuu-flex niuu-flex-col niuu-gap-6 niuu-p-6" data-testid="credentials-page">
      <header className="niuu-flex niuu-items-center niuu-justify-between">
        <div>
          <h2 className="niuu-text-lg niuu-font-semibold niuu-text-text-primary">Credentials</h2>
          <p className="niuu-text-sm niuu-text-text-muted">
            Secrets injected into pods as env vars or mounted files. Rotated centrally.
          </p>
        </div>
        <button
          className="niuu-rounded niuu-bg-brand niuu-px-4 niuu-py-2 niuu-text-sm niuu-font-medium niuu-text-bg-primary"
          aria-label="New credential"
          data-testid="new-credential-btn"
        >
          + new credential
        </button>
      </header>

      {credentials.isLoading && (
        <div className="niuu-flex niuu-items-center niuu-gap-2" data-testid="credentials-loading">
          <StateDot state="processing" pulse />
          <span className="niuu-text-sm niuu-text-text-muted">Loading credentials\u2026</span>
        </div>
      )}

      {credentials.isError && (
        <div className="niuu-flex niuu-items-center niuu-gap-2" data-testid="credentials-error">
          <StateDot state="failed" />
          <span className="niuu-text-sm niuu-text-text-muted">Failed to load credentials</span>
        </div>
      )}

      {credentials.data && credentials.data.length === 0 && (
        <p className="niuu-text-sm niuu-text-text-muted" data-testid="no-credentials">
          No credentials stored yet.
        </p>
      )}

      {credentials.data && credentials.data.length > 0 && (
        <Table<StoredCredential>
          columns={COLUMNS}
          rows={credentials.data}
          aria-label="Credentials"
        />
      )}
    </div>
  );
}
