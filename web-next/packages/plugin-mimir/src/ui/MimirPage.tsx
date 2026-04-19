import { Rune, StateDot, Chip } from '@niuulabs/ui';
import { useMimirMounts } from './useMimirMounts';

export function MimirPage() {
  const { data, isLoading, isError, error } = useMimirMounts();

  return (
    <div style={{ padding: 'var(--space-6)', maxWidth: 960 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <Rune glyph="ᛗ" size={32} />
        <h2 style={{ margin: 0 }}>Mímir · the well of knowledge</h2>
      </div>
      <p style={{ color: 'var(--color-text-secondary)' }}>
        Knowledge-base management: mounts, pages, sources, entities, lint, and dream cycles.
      </p>

      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state="processing" pulse />
          <span>loading mounts…</span>
        </div>
      )}

      {isError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'unknown error'}</span>
        </div>
      )}

      {data && (
        <div>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
            <strong style={{ color: 'var(--color-text-primary)' }}>{data.length}</strong> mount
            {data.length !== 1 ? 's' : ''} connected
          </p>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
            {data.map((mount) => (
              <li
                key={mount.name}
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
                    mount.status === 'healthy'
                      ? 'healthy'
                      : mount.status === 'degraded'
                        ? 'observing'
                        : 'failed'
                  }
                />
                <span
                  style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}
                >
                  {mount.name}
                </span>
                <Chip tone="neutral">{mount.role}</Chip>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                  {mount.pages} pages
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
