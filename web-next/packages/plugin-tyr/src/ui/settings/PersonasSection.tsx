import { useState } from 'react';
import { StateDot } from '@niuulabs/ui';
import type { TyrPersonaSummary } from '../../ports';
import { usePersonasBrowser, usePersonaYaml } from './usePersonasBrowser';

interface PersonaRowProps {
  persona: TyrPersonaSummary;
  selected: boolean;
  onSelect: (name: string) => void;
}

function PersonaRow({ persona, selected, onSelect }: PersonaRowProps) {
  return (
    <button
      type="button"
      className={[
        'niuu-w-full niuu-text-left niuu-px-3 niuu-py-2 niuu-rounded-md niuu-transition-colors',
        'niuu-flex niuu-items-center niuu-gap-3 niuu-border niuu-border-transparent',
        selected
          ? 'niuu-bg-bg-elevated niuu-border-border'
          : 'hover:niuu-bg-bg-secondary niuu-text-text-primary',
      ].join(' ')}
      onClick={() => onSelect(persona.name)}
      aria-pressed={selected}
    >
      <span className="niuu-font-mono niuu-text-sm niuu-text-text-primary niuu-flex-1 niuu-truncate">
        {persona.name}
      </span>
      {persona.isBuiltin && (
        <span className="niuu-text-xs niuu-text-text-muted niuu-shrink-0">builtin</span>
      )}
      {persona.hasOverride && (
        <span className="niuu-text-xs niuu-text-accent-amber niuu-shrink-0">overridden</span>
      )}
    </button>
  );
}

interface YamlViewerProps {
  personaName: string;
}

function YamlViewer({ personaName }: YamlViewerProps) {
  const { data: yaml, isLoading, isError, error } = usePersonaYaml(personaName);

  if (isLoading) {
    return (
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-p-4" role="status">
        <StateDot state="processing" pulse />
        <span className="niuu-text-sm niuu-text-text-secondary">loading YAML…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-p-4" role="alert">
        <StateDot state="failed" />
        <span className="niuu-text-sm niuu-text-critical">
          {error instanceof Error ? error.message : 'failed to load YAML'}
        </span>
      </div>
    );
  }

  return (
    <pre className="niuu-overflow-auto niuu-p-4 niuu-m-0 niuu-text-xs niuu-font-mono niuu-text-text-primary niuu-bg-bg-secondary niuu-rounded-md niuu-leading-relaxed niuu-whitespace-pre-wrap">
      {yaml}
    </pre>
  );
}

interface FilterTab {
  value: 'all' | 'builtin' | 'custom';
  label: string;
}

const FILTER_TABS: FilterTab[] = [
  { value: 'all', label: 'All' },
  { value: 'builtin', label: 'Builtin' },
  { value: 'custom', label: 'Custom' },
];

export function PersonasSection() {
  const [filter, setFilter] = useState<'all' | 'builtin' | 'custom'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const { data: personas, isLoading, isError, error } = usePersonasBrowser(filter);

  return (
    <section aria-label="Personas browser">
      <h3 className="niuu-text-base niuu-font-semibold niuu-text-text-primary niuu-mb-1">
        Personas
      </h3>
      <p className="niuu-text-sm niuu-text-text-secondary niuu-mb-4">
        Browse and inspect persona configurations managed by Ravn. Select a persona to view its YAML
        source.
      </p>

      {/* Filter tabs */}
      <div
        className="niuu-flex niuu-gap-1 niuu-mb-3"
        role="tablist"
        aria-label="Persona filter"
      >
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={filter === tab.value}
            className={[
              'niuu-px-3 niuu-py-1 niuu-rounded-md niuu-text-sm niuu-transition-colors',
              filter === tab.value
                ? 'niuu-bg-bg-elevated niuu-text-text-primary'
                : 'niuu-text-text-secondary hover:niuu-text-text-primary',
            ].join(' ')}
            onClick={() => {
              setFilter(tab.value);
              setSelected(null);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="niuu-grid niuu-grid-cols-[240px_1fr] niuu-gap-4 niuu-min-h-[320px]">
        {/* Persona list */}
        <div
          className="niuu-border niuu-border-border niuu-rounded-md niuu-overflow-y-auto niuu-flex niuu-flex-col niuu-gap-0.5 niuu-p-1"
          role="listbox"
          aria-label="Persona list"
          aria-multiselectable="false"
        >
          {isLoading && (
            <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-p-3" role="status">
              <StateDot state="processing" pulse />
              <span className="niuu-text-sm niuu-text-text-secondary">loading personas…</span>
            </div>
          )}

          {isError && (
            <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-p-3" role="alert">
              <StateDot state="failed" />
              <span className="niuu-text-sm niuu-text-critical">
                {error instanceof Error ? error.message : 'failed to load'}
              </span>
            </div>
          )}

          {personas?.map((persona) => (
            <PersonaRow
              key={persona.name}
              persona={persona}
              selected={selected === persona.name}
              onSelect={setSelected}
            />
          ))}

          {personas?.length === 0 && !isLoading && (
            <p className="niuu-text-sm niuu-text-text-muted niuu-p-3">No personas found.</p>
          )}
        </div>

        {/* YAML viewer */}
        <div className="niuu-border niuu-border-border niuu-rounded-md niuu-overflow-hidden niuu-bg-bg-secondary">
          {selected ? (
            <YamlViewer personaName={selected} />
          ) : (
            <div className="niuu-flex niuu-items-center niuu-justify-center niuu-h-full niuu-p-6">
              <p className="niuu-text-sm niuu-text-text-muted">
                Select a persona to view its YAML source.
              </p>
            </div>
          )}
        </div>
      </div>

      {personas && (
        <p className="niuu-text-xs niuu-text-text-muted niuu-mt-2">
          {personas.length} persona{personas.length !== 1 ? 's' : ''}
        </p>
      )}
    </section>
  );
}
