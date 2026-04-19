import {
  StatusBadge,
  ConfidenceBar,
  ConfidenceBadge,
  Pipe,
  type BadgeStatus,
  type PipeCell,
} from '@niuulabs/ui';

const ALL_STATUSES: BadgeStatus[] = [
  'running',
  'active',
  'complete',
  'merged',
  'review',
  'queued',
  'escalated',
  'blocked',
  'pending',
  'failed',
  'archived',
  'gated',
];

const PIPE_CELLS: PipeCell[] = [
  { status: 'ok', label: 'Decompose (complete)' },
  { status: 'ok', label: 'Research (complete)' },
  { status: 'run', label: 'Draft (running)' },
  { status: 'warn', label: 'Review (blocked)' },
  { status: 'pend', label: 'Ship (pending)' },
];

const PIPE_FAILED: PipeCell[] = [
  { status: 'ok', label: 'Setup (complete)' },
  { status: 'crit', label: 'Build (failed)' },
  { status: 'pend', label: 'Verify (pending)' },
];

const PIPE_GATED: PipeCell[] = [
  { status: 'ok', label: 'Plan' },
  { status: 'gate', label: 'Approval gate' },
  { status: 'pend', label: 'Execute' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section data-testid={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <h3
        style={{
          margin: '0 0 var(--space-3)',
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-mono)',
          color: 'var(--color-text-secondary)',
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

export function StatusShowcasePage() {
  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 720 }}>
      <h2 style={{ margin: '0 0 var(--space-6)', fontFamily: 'var(--font-mono)' }}>
        status composites · showcase
      </h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
        <Section title="StatusBadge — all statuses">
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}
            data-testid="status-badge-grid"
          >
            {ALL_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
        </Section>

        <Section title="StatusBadge — pulsing">
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <StatusBadge status="running" pulse />
            <StatusBadge status="active" pulse />
          </div>
        </Section>

        <Section title="ConfidenceBar — levels">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              alignItems: 'flex-start',
            }}
            data-testid="confidence-bar-grid"
          >
            <ConfidenceBar level="high" />
            <ConfidenceBar level="medium" />
            <ConfidenceBar level="low" />
          </div>
        </Section>

        <Section title="ConfidenceBadge — value range">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              alignItems: 'flex-start',
            }}
            data-testid="confidence-badge-grid"
          >
            {([null, 0, 0.28, 0.5, 0.64, 0.8, 0.92] as (number | null)[]).map((v, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <code style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 40 }}>
                  {v === null ? 'null' : String(v)}
                </code>
                <ConfidenceBadge value={v} />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Pipe — phase progress">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              alignItems: 'flex-start',
            }}
            data-testid="pipe-grid"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <code style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 72 }}>
                mixed
              </code>
              <Pipe cells={PIPE_CELLS} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <code style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 72 }}>
                failed
              </code>
              <Pipe cells={PIPE_FAILED} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <code style={{ fontSize: 11, color: 'var(--color-text-muted)', width: 72 }}>
                gated
              </code>
              <Pipe cells={PIPE_GATED} />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
