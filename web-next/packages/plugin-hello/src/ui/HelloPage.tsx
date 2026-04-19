import { Chip, StateDot, Rune } from '@niuulabs/ui';
import { useGreetings } from './useGreetings';

export function HelloPage() {
  const { data, isLoading, isError, error } = useGreetings();

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
        <Rune glyph="ᚺ" size={32} />
        <h2 style={{ margin: 0 }}>hello · smoke test</h2>
      </div>
      <p style={{ color: 'var(--color-text-secondary)' }}>
        This plugin proves the end-to-end composability loop: PluginDescriptor → Shell →
        ServicesProvider → TanStack Query → UI.
      </p>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state="processing" pulse />
          <span>loading…</span>
        </div>
      )}

      {isError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'unknown error'}</span>
        </div>
      )}

      {data && (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
          {data.map((g) => (
            <li
              key={g.id}
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
                state={g.mood === 'warm' ? 'healthy' : g.mood === 'cold' ? 'idle' : 'observing'}
              />
              <span style={{ flex: 1 }}>{g.text}</span>
              <Chip tone="brand">{g.mood}</Chip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
