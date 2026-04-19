import { Rune, StateDot } from '@niuulabs/ui';
import { usePersonas } from './usePersonas';

export function RavnPage() {
  const { data, isLoading, isError, error } = usePersonas();

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
        <Rune glyph="ᚱ" size={32} />
        <h2 style={{ margin: 0 }}>ravn · personas · ravens · sessions</h2>
      </div>

      <p style={{ color: 'var(--color-text-secondary)' }}>
        Ravn is the canonical authority for Persona, ToolRegistry, EventCatalog, and BudgetState.
        This placeholder will be replaced by the full Ravn UI.
      </p>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state="processing" pulse />
          <span>loading personas…</span>
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
          {data.length} persona{data.length !== 1 ? 's' : ''} loaded.
        </p>
      )}
    </div>
  );
}
