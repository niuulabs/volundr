import { cn, PersonaAvatar } from '@niuulabs/ui';
import type { PersonaRole } from '@niuulabs/domain';
import { usePersonas } from './usePersonas';
import { PERSONA_ROLE_ORDER } from '../catalog';
import './PersonaList.css';

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
  onNew?: () => void;
}

export function PersonaList({ selectedName, onSelect, onNew }: PersonaListProps) {
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
            <div
              className="rv-persona-role-header niuu-py-1 niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-uppercase niuu-tracking-widest"
              data-role={role}
              data-testid={`persona-role-header-${role}`}
            >
              {ROLE_LABEL[role]}
            </div>
            {personas.map((p) => {
              const isSelected = p.name === selectedName;
              return (
                <button
                  key={p.name}
                  type="button"
                  aria-current={isSelected ? 'page' : undefined}
                  onClick={() => onSelect(p.name)}
                  className={cn(
                    'niuu-flex niuu-items-center niuu-gap-2 niuu-w-full niuu-px-3 niuu-py-2',
                    'niuu-text-left niuu-text-sm niuu-font-sans niuu-rounded-none niuu-border-0',
                    'niuu-transition-colors',
                    isSelected
                      ? 'rv-persona-row--selected niuu-bg-bg-tertiary niuu-text-text-primary'
                      : 'niuu-bg-transparent niuu-text-text-secondary hover:niuu-bg-bg-tertiary hover:niuu-text-text-primary',
                  )}
                >
                  <PersonaAvatar role={p.role} letter={p.letter} size={24} />
                  <span className="niuu-truncate niuu-flex-1">{p.name}</span>
                  {p.isBuiltin && (
                    <span className="niuu-text-xs niuu-text-text-muted niuu-shrink-0">builtin</span>
                  )}
                </button>
              );
            })}
          </div>
        );
      })}

      {/* New persona button */}
      <div className="niuu-px-3 niuu-mt-auto niuu-pt-3 niuu-pb-2">
        <button
          type="button"
          onClick={onNew}
          data-testid="persona-new-button"
          className="niuu-w-full niuu-px-3 niuu-py-2 niuu-text-sm niuu-text-text-muted niuu-border niuu-border-dashed niuu-border-border niuu-rounded-md niuu-bg-transparent niuu-cursor-pointer hover:niuu-border-brand hover:niuu-text-text-primary niuu-transition-colors"
        >
          + New persona
        </button>
      </div>
    </nav>
  );
}
