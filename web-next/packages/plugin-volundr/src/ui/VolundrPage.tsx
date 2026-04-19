import { Rune, StateDot, Chip } from '@niuulabs/ui';
import { useVolundrSessions, useVolundrStats } from './useVolundrSessions';

export function VolundrPage() {
  const sessions = useVolundrSessions();
  const stats = useVolundrStats();

  return (
    <div className="niuu-p-6 niuu-max-w-[800px]">
      <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-mb-4">
        <Rune glyph="ᚲ" size={32} />
        <h2 className="niuu-m-0">Völundr · session forge</h2>
      </div>

      <p className="niuu-text-text-secondary niuu-mb-6">
        Provisions and manages remote dev pods. Sessions move through a lifecycle: requested →
        provisioning → ready → running → idle → terminating → terminated.
      </p>

      {stats.data && (
        <div className="niuu-grid niuu-grid-cols-3 niuu-gap-3 niuu-mb-6">
          <KpiTile label="active" value={stats.data.activeSessions} />
          <KpiTile label="total" value={stats.data.totalSessions} />
          <KpiTile label="tokens today" value={stats.data.tokensToday.toLocaleString()} />
        </div>
      )}

      {sessions.isLoading && (
        <div className="niuu-flex niuu-items-center niuu-gap-2" role="status">
          <StateDot state="processing" pulse />
          <span>loading sessions…</span>
        </div>
      )}

      {sessions.isError && (
        <div className="niuu-flex niuu-items-center niuu-gap-2" role="alert">
          <StateDot state="failed" />
          <span>
            {sessions.error instanceof Error ? sessions.error.message : 'failed to load sessions'}
          </span>
        </div>
      )}

      {sessions.data && sessions.data.length === 0 && (
        <p className="niuu-text-text-muted">No sessions yet — start one to get going.</p>
      )}

      {sessions.data && sessions.data.length > 0 && (
        <ul className="niuu-list-none niuu-p-0 niuu-grid niuu-gap-3">
          {sessions.data.map((s) => (
            <li
              key={s.id}
              className="niuu-flex niuu-items-center niuu-gap-3 niuu-p-3 niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary"
            >
              <StateDot
                state={
                  s.status === 'running'
                    ? 'healthy'
                    : s.status === 'error'
                      ? 'failed'
                      : s.status === 'stopped' || s.status === 'archived'
                        ? 'idle'
                        : 'processing'
                }
              />
              <span className="niuu-flex-1 niuu-font-mono niuu-text-sm">{s.name}</span>
              <Chip tone="muted">{s.status}</Chip>
              <Chip tone="brand">{s.model}</Chip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="niuu-p-4 niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-secondary">
      <div className="niuu-text-2xl niuu-font-bold niuu-font-mono niuu-text-text-primary">
        {value}
      </div>
      <div className="niuu-text-xs niuu-text-text-muted niuu-mt-1">{label}</div>
    </div>
  );
}
