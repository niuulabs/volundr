import { Rune, StateDot } from '@niuulabs/ui';
import { useTopology } from '../application/useTopology';
import { useEvents } from '../application/useEvents';
import type { EventSeverity } from '../domain';

function severityToDotState(severity: EventSeverity) {
  if (severity === 'error') return 'failed' as const;
  if (severity === 'warn') return 'attention' as const;
  if (severity === 'debug') return 'idle' as const;
  return 'healthy' as const;
}

export function ObservatoryPage() {
  const topology = useTopology();
  const events = useEvents();

  const nodeCount = topology?.nodes.length ?? 0;
  const edgeCount = topology?.edges.length ?? 0;
  const recentEvents = events.slice(-5);

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 960 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-2)',
        }}
      >
        <Rune glyph="ᚠ" size={32} />
        <h2 style={{ margin: 0 }}>Observatory</h2>
      </div>
      <p style={{ margin: '0 0 var(--space-6)', color: 'var(--color-text-secondary)' }}>
        live topology · canvas coming soon
      </p>

      {topology ? (
        <div style={{ display: 'flex', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <StatCard label="nodes" value={nodeCount} />
          <StatCard label="edges" value={edgeCount} />
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <StateDot state="processing" pulse />
          <span>connecting…</span>
        </div>
      )}

      {recentEvents.length > 0 && (
        <section>
          <h3
            style={{
              margin: '0 0 var(--space-3)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)',
            }}
          >
            Recent events
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
            {recentEvents.map((ev) => (
              <li
                key={ev.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-3)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg-secondary)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                <StateDot state={severityToDotState(ev.severity)} />
                <span style={{ color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {ev.sourceId}
                </span>
                <span style={{ flex: 1 }}>{ev.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: 'var(--space-4)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-secondary)',
        minWidth: 100,
      }}
    >
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{value}</div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>{label}</div>
    </div>
  );
}
