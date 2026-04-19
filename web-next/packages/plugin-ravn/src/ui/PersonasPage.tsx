import { useState, useCallback } from 'react';
import { Rune } from '@niuulabs/ui';
import { useService } from '@niuulabs/plugin-sdk';
import type { IPersonaStore, PersonaCreateRequest } from '../ports';
import { PersonaList } from './PersonaList';
import { PersonaForm } from './PersonaForm';
import { PersonaYaml } from './PersonaYaml';
import { PersonaSubs } from './PersonaSubs';
import { usePersona, useUpdatePersona } from './usePersona';

type TabId = 'form' | 'yaml' | 'subs';

// ── Persona detail pane ────────────────────────────────────────────────────

interface PersonaDetailPaneProps {
  name: string;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

function PersonaDetailPane({ name, activeTab, onTabChange }: PersonaDetailPaneProps) {
  const { data: persona } = usePersona(name);
  const { mutateAsync: updatePersona, isPending: isSaving } = useUpdatePersona(name);

  const handleSave = useCallback(
    async (req: PersonaCreateRequest) => {
      await updatePersona(req);
    },
    [updatePersona],
  );

  const tabs: { id: TabId; label: string }[] = [
    { id: 'form', label: 'Form' },
    { id: 'yaml', label: 'YAML' },
    { id: 'subs', label: 'Subs' },
  ];

  return (
    <div className="niuu-flex niuu-flex-col niuu-h-full" data-testid="persona-detail">
      {/* Tab bar */}
      <div className="niuu-flex niuu-items-center niuu-border-b niuu-border-border niuu-px-4 niuu-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            className={[
              'niuu-px-4 niuu-py-2.5 niuu-text-sm niuu-font-sans niuu-border-0 niuu-bg-transparent niuu-cursor-pointer',
              'niuu-border-b-2 niuu-transition-colors',
              activeTab === tab.id
                ? 'niuu-text-text-primary niuu-border-brand'
                : 'niuu-text-text-muted niuu-border-transparent hover:niuu-text-text-secondary hover:niuu-border-border',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="niuu-flex-1 niuu-overflow-hidden">
        {activeTab === 'form' && persona && (
          <PersonaForm persona={persona} onSave={handleSave} isSaving={isSaving} />
        )}
        {activeTab === 'yaml' && <PersonaYaml name={name} />}
        {activeTab === 'subs' && <PersonaSubs name={name} />}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export function PersonasPage() {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('form');

  const handleSelect = useCallback((name: string) => {
    setSelectedName(name);
    setActiveTab('form');
  }, []);

  return (
    <div className="niuu-flex niuu-h-full niuu-overflow-hidden" data-testid="personas-page">
      {/* Left panel — persona list */}
      <div className="niuu-w-56 niuu-shrink-0 niuu-border-r niuu-border-border niuu-overflow-hidden niuu-flex niuu-flex-col niuu-bg-bg-secondary">
        <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-px-3 niuu-py-3 niuu-border-b niuu-border-border-subtle niuu-shrink-0">
          <Rune glyph="ᚱ" size={16} />
          <span className="niuu-text-xs niuu-font-mono niuu-text-text-secondary">
            ravn · personas · ravens · sessions
          </span>
        </div>
        <div className="niuu-flex-1 niuu-overflow-y-auto">
          <PersonaList selectedName={selectedName} onSelect={handleSelect} />
        </div>
      </div>

      {/* Right panel — detail pane */}
      <div className="niuu-flex-1 niuu-overflow-hidden niuu-bg-bg-primary">
        {selectedName ? (
          <PersonaDetailPane name={selectedName} activeTab={activeTab} onTabChange={setActiveTab} />
        ) : (
          <EmptyState />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  // Access the service to display the total count
  const service = useService<IPersonaStore>('ravn.personas');
  // We just provide a stable reference here; the count is shown in PersonaList
  void service; // suppress unused warning

  return (
    <div
      className="niuu-flex niuu-flex-col niuu-items-center niuu-justify-center niuu-h-full niuu-gap-4 niuu-text-text-muted"
      data-testid="personas-empty-state"
    >
      <Rune glyph="ᚱ" size={48} muted />
      <p className="niuu-m-0 niuu-text-sm">Select a persona from the list to edit it.</p>
    </div>
  );
}
