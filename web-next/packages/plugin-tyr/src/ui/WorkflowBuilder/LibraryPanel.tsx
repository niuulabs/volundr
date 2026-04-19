/**
 * LibraryPanel — draggable persona chips for assignment to stage nodes.
 *
 * Personas can be dragged from this panel onto a stage node in the GraphView
 * to add them to `personaIds`. The drag payload is the persona ID (string),
 * transferred via DataTransfer.
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

export interface PersonaEntry {
  id: string;
  label: string;
  role: string;
}

export interface LibraryPanelProps {
  personas: PersonaEntry[];
}

// Default mock persona library — used when no personas are passed.
export const DEFAULT_PERSONAS: PersonaEntry[] = [
  { id: 'persona-plan', label: 'Planner', role: 'plan' },
  { id: 'persona-build', label: 'Builder', role: 'build' },
  { id: 'persona-verify', label: 'Verifier', role: 'verify' },
  { id: 'persona-review', label: 'Reviewer', role: 'review' },
  { id: 'persona-gate', label: 'Gatekeeper', role: 'gate' },
  { id: 'persona-ship', label: 'Shipper', role: 'ship' },
];

export function LibraryPanel({ personas }: LibraryPanelProps) {
  return (
    <div
      data-testid="library-panel"
      style={{
        width: 140,
        flexShrink: 0,
        borderLeft: '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 10px 6px',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 1,
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-sans)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        Personas
      </div>
      <div
        style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto' }}
      >
        {personas.map((persona) => (
          <div
            key={persona.id}
            data-testid={`persona-chip-${persona.id}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/niuu-persona-id', persona.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            style={{
              padding: '6px 8px',
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 4,
              cursor: 'grab',
              fontSize: 11,
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-sans)',
              userSelect: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span
              style={{ fontSize: 8, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}
            >
              {persona.role}
            </span>
            <span>{persona.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
