import { Rune, StatusBadge, ConfidenceBar, ConfidenceBadge, Pipe } from '@niuulabs/ui';
import type { StatusBadgeStatus } from '@niuulabs/ui';
import type { PipePhase } from '@niuulabs/ui';

const STATUSES: StatusBadgeStatus[] = ['running', 'queued', 'ok', 'review', 'failed', 'archived'];

const SAMPLE_PIPE: PipePhase[] = [
  { status: 'done', label: 'fetch' },
  { status: 'done', label: 'parse' },
  { status: 'running', label: 'store' },
  { status: 'pending', label: 'emit' },
  { status: 'pending', label: 'notify' },
];

const FAILED_PIPE: PipePhase[] = [
  { status: 'done', label: 'fetch' },
  { status: 'failed', label: 'parse' },
  { status: 'skipped', label: 'store' },
  { status: 'skipped', label: 'emit' },
];

export function ShowcasePage() {
  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 720 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <Rune glyph="ᚺ" size={32} />
        <h2 style={{ margin: 0 }}>status composites · showcase</h2>
      </div>

      <section style={{ marginBottom: 'var(--space-8)' }}>
        <h3 style={{ marginBottom: 'var(--space-3)', color: 'var(--color-text-secondary)' }}>
          StatusBadge
        </h3>
        <div
          data-testid="status-badges"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}
        >
          {STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 'var(--space-8)' }}>
        <h3 style={{ marginBottom: 'var(--space-3)', color: 'var(--color-text-secondary)' }}>
          ConfidenceBar
        </h3>
        <div data-testid="confidence-bars" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <ConfidenceBar level="high" value={0.88} showLabel />
          <ConfidenceBar level="medium" value={0.52} showLabel />
          <ConfidenceBar level="low" value={0.18} showLabel />
        </div>
      </section>

      <section style={{ marginBottom: 'var(--space-8)' }}>
        <h3 style={{ marginBottom: 'var(--space-3)', color: 'var(--color-text-secondary)' }}>
          ConfidenceBadge
        </h3>
        <div
          data-testid="confidence-badges"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'center' }}
        >
          <ConfidenceBadge value={0.92} />
          <ConfidenceBadge value={0.55} />
          <ConfidenceBadge value={0.2} />
          <ConfidenceBadge value={null} />
          <ConfidenceBadge value={0} />
        </div>
      </section>

      <section style={{ marginBottom: 'var(--space-8)' }}>
        <h3 style={{ marginBottom: 'var(--space-3)', color: 'var(--color-text-secondary)' }}>
          Pipe
        </h3>
        <div data-testid="pipes" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Pipe phases={SAMPLE_PIPE} />
          <Pipe phases={FAILED_PIPE} />
          <Pipe
            phases={Array.from({ length: 10 }, (_, i) => ({
              status: 'done' as const,
              label: `step-${i + 1}`,
            }))}
          />
        </div>
      </section>
    </div>
  );
}
