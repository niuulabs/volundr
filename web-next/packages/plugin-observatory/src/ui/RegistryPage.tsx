import { Rune, Chip, StateDot } from '@niuulabs/ui';
import { useRegistry } from '../application/useRegistry';

export function RegistryPage() {
  const { data, isLoading, isError, error } = useRegistry();

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
        <Rune glyph="ᛞ" size={32} />
        <h2 style={{ margin: 0 }}>Registry</h2>
      </div>
      <p style={{ margin: '0 0 var(--space-6)', color: 'var(--color-text-secondary)' }}>
        entity type definitions
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
        <>
          <p
            style={{
              margin: '0 0 var(--space-4)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            v{data.version} · {data.types.length} types · updated {data.updatedAt.slice(0, 10)}
          </p>
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--space-2)' }}>
            {data.types.map((t) => (
              <li
                key={t.id}
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
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xl)',
                    width: 24,
                    textAlign: 'center',
                  }}
                >
                  {t.rune}
                </span>
                <span style={{ flex: 1 }}>{t.label}</span>
                <Chip tone="muted">{t.category}</Chip>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
