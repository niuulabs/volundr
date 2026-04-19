import { Rune, StateDot, Chip } from '@niuulabs/ui';
import { useVolundrSessions, useVolundrStats } from './useVolundrSessions';

export function VolundrPage() {
  const sessions = useVolundrSessions();
  const stats = useVolundrStats();

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 800 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <Rune glyph="ᚲ" size={32} />
        <h2 style={{ margin: 0 }}>Völundr · session forge</h2>
      </div>

      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
        Provisions and manages remote dev pods. Sessions move through a lifecycle:
        requested → provisioning → ready → running → idle → terminating → terminated.
      </p>

      {stats.data && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-3)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <KpiTile label="active" value={stats.data.activeSessions} />
          <KpiTile label="total" value={stats.data.totalSessions} />
          <KpiTile label="tokens today" value={stats.data.tokensToday.toLocaleString()} />
        </div>
      )}

      {sessions.isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state="processing" pulse />
          <span>loading sessions…</span>
        </div>
      )}

      {sessions.isError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state="failed" />
          <span>
            {sessions.error instanceof Error ? sessions.error.message : 'failed to load sessions'}
          </span>
        </div>
      )}

      {sessions.data && sessions.data.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>No sessions yet — start one to get going.</p>
      )}

      {sessions.data && sessions.data.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
          {sessions.data.map((s) => (
            <li
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-secondary)',
              }}
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
              <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
                {s.name}
              </span>
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
    <div
      style={{
        padding: 'var(--space-4)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
        {label}
      </div>
    </div>
  );
}
