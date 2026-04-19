import { Rune, StateDot } from '@niuulabs/ui';
import { useSagas } from './useSagas';

export function TyrPage() {
  const { data, isLoading, isError, error } = useSagas();

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 720 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <Rune glyph="ᛏ" size={32} />
        <h2 style={{ margin: 0 }}>tyr · sagas · raids · dispatch</h2>
      </div>

      <p style={{ color: 'var(--color-text-secondary)' }}>
        Tyr is the autonomous execution engine. It decomposes product goals into Sagas, breaks
        Sagas into phased Raids, and dispatches Raids to autonomous agents. This placeholder will
        be replaced by the full Tyr UI.
      </p>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state="processing" pulse />
          <span>loading sagas…</span>
        </div>
      )}

      {isError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'unknown error'}</span>
        </div>
      )}

      {data && (
        <p style={{ color: 'var(--color-text-secondary)' }}>
          {data.length} saga{data.length !== 1 ? 's' : ''} loaded.
        </p>
      )}
    </div>
  );
}
