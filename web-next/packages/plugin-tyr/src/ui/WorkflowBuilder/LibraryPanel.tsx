/**
 * LibraryPanel — block palette + categorised persona library.
 *
 * Sits on the left side of the canvas (between the templates sidebar and
 * the graph). Contains structural block types (Stage, Condition, Human gate,
 * End) and categorised persona entries grouped by role.
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import { useState } from 'react';

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
  { id: 'persona-decomposer', label: 'decomposer', role: 'plan' },
  { id: 'persona-investigator', label: 'investigator', role: 'plan' },
  { id: 'persona-coding-agent', label: 'coding-agent', role: 'build' },
  { id: 'persona-coder', label: 'coder', role: 'build' },
  { id: 'persona-raid-executor', label: 'raid-executor', role: 'build' },
  { id: 'persona-qa', label: 'qa-agent', role: 'verify' },
  { id: 'persona-verifier', label: 'verifier', role: 'verify' },
  { id: 'persona-reviewer', label: 'reviewer', role: 'review' },
  { id: 'persona-gatekeeper', label: 'gatekeeper', role: 'gate' },
];

const BLOCKS = [
  { id: 'stage', icon: '◆', label: 'Stage' },
  { id: 'cond', icon: '?', label: 'Condition' },
  { id: 'gate', icon: '⌘', label: 'Human gate' },
  { id: 'end', icon: '●', label: 'End' },
];

const ROLE_INITIALS: Record<string, string> = {
  plan: 'P',
  build: 'C',
  verify: 'V',
  review: 'R',
  gate: 'G',
  ship: 'S',
};

const ROLE_HINTS: Record<string, string> = {
  plan: 'goal decomposition',
  build: 'implementation crew',
  verify: 'checks and evidence',
  review: 'release scrutiny',
  gate: 'human approvals',
  ship: 'handoff and release',
};

const ROLE_BG: Record<string, string> = {
  plan: 'niuu-border-status-cyan niuu-text-status-cyan',
  build: 'niuu-border-brand niuu-text-brand',
  verify: 'niuu-border-status-amber niuu-text-status-amber',
  review: 'niuu-border-status-emerald niuu-text-status-emerald',
  gate: 'niuu-border-status-purple niuu-text-status-purple',
  ship: 'niuu-border-text-secondary niuu-text-text-secondary',
};

function groupByRole(personas: PersonaEntry[]): [string, PersonaEntry[]][] {
  const groups = new Map<string, PersonaEntry[]>();
  for (const p of personas) {
    const list = groups.get(p.role) ?? [];
    list.push(p);
    groups.set(p.role, list);
  }
  return [...groups.entries()];
}

export function LibraryPanel({ personas }: LibraryPanelProps) {
  const [search, setSearch] = useState('');
  const filtered = search
    ? personas.filter(
        (p) =>
          p.label.toLowerCase().includes(search.toLowerCase()) ||
          p.role.toLowerCase().includes(search.toLowerCase()),
      )
    : personas;
  const groups = groupByRole(filtered);

  return (
    <div
      data-testid="library-panel"
      className="niuu-w-[244px] niuu-shrink-0 niuu-border-r niuu-border-border niuu-bg-bg-secondary niuu-flex niuu-flex-col niuu-overflow-hidden"
    >
      {/* Header */}
      <div className="niuu-flex niuu-items-start niuu-justify-between niuu-px-4 niuu-pt-3 niuu-pb-2">
        <div className="niuu-flex niuu-flex-col niuu-gap-0.5">
          <span className="niuu-text-sm niuu-font-semibold niuu-text-text-primary niuu-font-sans">
            Library
          </span>
          <span className="niuu-text-[10px] niuu-font-mono niuu-text-text-faint">
            Blocks, personas, lane starters
          </span>
        </div>
        <button
          type="button"
          className="niuu-bg-transparent niuu-border-none niuu-text-text-muted niuu-cursor-pointer niuu-text-sm niuu-p-0 hover:niuu-text-text-secondary"
        >
          +
        </button>
      </div>

      {/* Search */}
      <div className="niuu-px-3 niuu-pb-2">
        <input
          type="text"
          placeholder="Search personas..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="library-search"
          className="niuu-w-full niuu-py-2 niuu-px-2.5 niuu-bg-bg-tertiary niuu-border niuu-border-solid niuu-border-border-subtle niuu-rounded-md niuu-text-text-secondary niuu-font-sans niuu-text-xs niuu-outline-none niuu-box-border"
        />
      </div>

      {/* Scrollable content */}
      <div className="niuu-flex-1 niuu-overflow-y-auto niuu-px-3 niuu-pb-3">
        {/* Blocks */}
        {!search && (
          <>
            <div className="niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-[0.24em] niuu-text-text-muted niuu-font-sans niuu-mb-1 niuu-mt-1">
              BLOCKS
            </div>
            <div className="niuu-flex niuu-flex-col niuu-gap-1 niuu-mb-3">
              {BLOCKS.map((b) => (
                <div
                  key={b.id}
                  draggable
                  className="niuu-py-2 niuu-px-3 niuu-bg-bg-elevated niuu-rounded-md niuu-border niuu-border-border-subtle niuu-cursor-grab niuu-text-xs niuu-text-text-primary niuu-font-sans niuu-select-none niuu-flex niuu-items-center niuu-gap-2.5"
                >
                  <span className="niuu-inline-flex niuu-items-center niuu-justify-center niuu-w-6 niuu-h-6 niuu-rounded-sm niuu-bg-bg-tertiary niuu-text-text-muted niuu-text-xs">
                    {b.icon}
                  </span>
                  <div className="niuu-flex niuu-flex-col niuu-leading-tight">
                    <span className="niuu-font-semibold">{b.label}</span>
                    <span className="niuu-text-[10px] niuu-text-text-faint niuu-font-mono">
                      drag to stage
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Persona groups */}
        {groups.map(([role, entries]) => (
          <div key={role}>
            <div className="niuu-flex niuu-items-start niuu-justify-between niuu-gap-2 niuu-mb-1 niuu-mt-2 niuu-px-0.5">
              <div className="niuu-flex niuu-flex-col niuu-gap-0.5">
                <span className="niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-[0.24em] niuu-text-text-muted niuu-font-sans">
                  {role}
                </span>
                <span className="niuu-text-[10px] niuu-text-text-faint niuu-font-mono">
                  {ROLE_HINTS[role] ?? 'workflow participants'}
                </span>
              </div>
              <span className="niuu-text-[10px] niuu-text-text-faint niuu-font-mono niuu-mt-0.5">
                {entries.length}
              </span>
            </div>
            <div className="niuu-flex niuu-flex-col niuu-gap-1">
              {entries.map((persona) => (
                <div
                  key={persona.id}
                  data-testid={`persona-chip-${persona.id}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/niuu-persona-id', persona.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  className="niuu-py-2 niuu-px-3 niuu-bg-bg-elevated niuu-rounded-md niuu-border niuu-border-border-subtle niuu-cursor-grab niuu-text-xs niuu-text-text-primary niuu-font-sans niuu-select-none niuu-flex niuu-items-start niuu-gap-2.5"
                >
                  <span
                    className={`niuu-inline-flex niuu-items-center niuu-justify-center niuu-w-6 niuu-h-6 niuu-rounded-full niuu-border niuu-text-[9px] niuu-font-bold niuu-shrink-0 niuu-bg-transparent niuu-mt-0.5 ${ROLE_BG[persona.role] ?? 'niuu-border-border niuu-text-text-muted'}`}
                  >
                    {ROLE_INITIALS[persona.role] ?? persona.role.charAt(0).toUpperCase()}
                  </span>
                  <div className="niuu-flex niuu-flex-col niuu-leading-tight niuu-min-w-0 niuu-flex-1">
                    <span className="niuu-text-text-primary niuu-font-semibold niuu-truncate">
                      {persona.label}
                    </span>
                    <span className="niuu-text-[10px] niuu-text-text-muted niuu-font-mono">
                      {persona.role} lane
                    </span>
                  </div>
                  <span className="niuu-ml-auto niuu-text-text-faint niuu-text-[10px] niuu-font-mono niuu-mt-0.5">
                    ⇔
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
