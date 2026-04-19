import { PersonaAvatar } from '@niuulabs/ui';
import type { PersonaRole } from '@niuulabs/domain';
import { usePersonas } from './usePersonas';
import { PERSONA_ROLE_ORDER } from '../catalog';

const ROLE_LABEL: Record<PersonaRole, string> = {
  plan: 'Plan',
  build: 'Build',
  verify: 'Verify',
  review: 'Review',
  gate: 'Gate',
  audit: 'Audit',
  ship: 'Ship',
  index: 'Index',
  report: 'Report',
};

export interface PersonaListProps {
  selectedName: string | null;
  onSelect: (name: string) => void;
}

export function PersonaList({ selectedName, onSelect }: PersonaListProps) {
  const { data, isLoading, isError, error } = usePersonas();

  if (isLoading) {
    return (
      <div
        data-testid="persona-list-loading"
        className="niuu-flex niuu-flex-col niuu-gap-1 niuu-p-3 niuu-text-sm niuu-text-text-muted"
      >
        <span>Loading personas…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="persona-list-error" className="niuu-p-3 niuu-text-sm niuu-text-critical">
        {error instanceof Error ? error.message : 'Failed to load personas'}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return <div className="niuu-p-3 niuu-text-sm niuu-text-text-muted">No personas found.</div>;
  }

  // Group by role, following PERSONA_ROLE_ORDER
  const byRole = new Map<PersonaRole, typeof data>();
  for (const role of PERSONA_ROLE_ORDER) {
    byRole.set(role, []);
  }
  for (const p of data) {
    const group = byRole.get(p.role);
    if (group) {
      group.push(p);
    } else {
      // Unknown role — fall back to first group
      byRole.get('plan')!.push(p);
    }
  }

  return (
    <nav
      aria-label="Personas"
      className="niuu-flex niuu-flex-col niuu-overflow-y-auto niuu-h-full niuu-py-2"
      data-testid="persona-list"
    >
      {PERSONA_ROLE_ORDER.map((role) => {
        const personas = byRole.get(role) ?? [];
        if (personas.length === 0) return null;

        return (
          <div key={role} className="niuu-mb-3">
            <div className="niuu-px-3 niuu-py-1 niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-uppercase niuu-tracking-widest">
              {ROLE_LABEL[role]}
            </div>
            {personas.map((p) => (
              <button
                key={p.name}
                type="button"
                aria-current={p.name === selectedName ? 'page' : undefined}
                onClick={() => onSelect(p.name)}
                className={[
                  'niuu-flex niuu-items-center niuu-gap-2 niuu-w-full niuu-px-3 niuu-py-2',
                  'niuu-text-left niuu-text-sm niuu-font-sans niuu-rounded-none niuu-border-0',
                  'niuu-transition-colors',
                  p.name === selectedName
                    ? 'niuu-bg-bg-tertiary niuu-text-text-primary'
                    : 'niuu-bg-transparent niuu-text-text-secondary hover:niuu-bg-bg-tertiary hover:niuu-text-text-primary',
                ].join(' ')}
              >
                <PersonaAvatar role={p.role} letter={p.letter} size={20} />
                <span className="niuu-truncate niuu-flex-1">{p.name}</span>
                {p.isBuiltin && (
                  <span className="niuu-text-xs niuu-text-text-muted niuu-shrink-0">builtin</span>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
