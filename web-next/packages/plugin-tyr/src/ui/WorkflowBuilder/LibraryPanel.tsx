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
      className="niuu-w-[140px] niuu-shrink-0 niuu-border-l niuu-border-border niuu-bg-bg-secondary niuu-flex niuu-flex-col niuu-overflow-hidden"
    >
      <div className="niuu-px-2.5 niuu-pt-2.5 niuu-pb-1.5 niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-widest niuu-text-text-muted niuu-font-sans niuu-border-b niuu-border-border">
        Personas
      </div>
      <div className="niuu-p-2 niuu-flex niuu-flex-col niuu-gap-1 niuu-overflow-y-auto">
        {personas.map((persona) => (
          <div
            key={persona.id}
            data-testid={`persona-chip-${persona.id}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/niuu-persona-id', persona.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            className="niuu-py-1.5 niuu-px-2 niuu-bg-bg-elevated niuu-border niuu-border-border niuu-rounded niuu-cursor-grab niuu-text-xs niuu-text-text-primary niuu-font-sans niuu-select-none niuu-flex niuu-items-center niuu-gap-1"
          >
            <span className="niuu-text-[8px] niuu-text-text-muted niuu-uppercase">
              {persona.role}
            </span>
            <span>{persona.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
