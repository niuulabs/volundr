import { Rune, StateDot } from '@niuulabs/ui';
import { useRegistry } from '../application/useRegistry';
import { RegistryEditor } from './RegistryEditor';

export function RegistryPage() {
  const { data, isLoading, isError, error } = useRegistry();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header — always visible */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-4) var(--space-6)',
          borderBottom: '1px solid var(--color-border-subtle)',
          flexShrink: 0,
        }}
      >
        <Rune glyph="ᛞ" size={28} />
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Registry</h2>
          <p
            style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}
          >
            entity type definitions
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {isLoading && (
          <div
            style={{
              padding: 'var(--space-6)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <StateDot state="processing" pulse />
            <span>loading…</span>
          </div>
        )}

        {isError && (
          <div
            style={{
              padding: 'var(--space-6)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <StateDot state="failed" />
            <span>{error instanceof Error ? error.message : 'unknown error'}</span>
          </div>
        )}

        {data && <RegistryEditor registry={data} />}
      </div>
    </div>
  );
}
