import { useState, useEffect, useCallback } from 'react';
import { Rune, PersonaAvatar } from '@niuulabs/ui';
import type { PersonaCreateRequest } from '../ports';
import { PersonaForm } from './PersonaForm';
import { PersonaYaml } from './PersonaYaml';
import { PersonaSubs } from './PersonaSubs';
import { usePersona, useUpdatePersona } from './usePersona';
import { loadStorage, saveStorage } from './storage';
import './ravn-views.css';

const PERSONA_STORAGE_KEY = 'ravn.persona';

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
    { id: 'form', label: 'form' },
    { id: 'yaml', label: 'yaml' },
    { id: 'subs', label: 'subscriptions' },
  ];

  return (
    <div className="niuu-flex niuu-flex-col niuu-h-full" data-testid="persona-detail">
      {/* Persona header — matches web2 pr-head */}
      {persona && (
        <div className="rv-pr-head">
          <div className="rv-pr-head__left">
            {persona.role && persona.letter && (
              <PersonaAvatar role={persona.role} letter={persona.letter} size={40} />
            )}
            <div className="rv-pr-head__info">
              <div className="rv-pr-head__name">{persona.name}</div>
              <div className="rv-pr-head__sub">
                role: <strong>{persona.role}</strong>
                <span className="rv-pr-head__sep">·</span>
                {persona.isBuiltin ? 'builtin' : 'user-defined'}
              </div>
              <div className="rv-pr-head__origin">
                <span className="rv-pr-head__origin-label">loaded from</span>
                <code className="rv-pr-head__origin-path">
                  {persona.yamlSource === '[mock]'
                    ? `volundr/src/ravn/personas/${persona.name}.yaml`
                    : persona.yamlSource}
                </code>
              </div>
            </div>
          </div>
          <div className="rv-pr-head__right">
            {/* Tab segment control */}
            <div className="rv-pr-seg">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`rv-pr-seg__btn${activeTab === tab.id ? ' rv-pr-seg__btn--active' : ''}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button type="button" className="rv-pr-action-btn">+ new persona</button>
            <button type="button" className="rv-pr-action-btn">clone as…</button>
            <button type="button" className="rv-pr-action-btn rv-pr-action-btn--primary">save</button>
          </div>
        </div>
      )}

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
  const [selectedName, setSelectedName] = useState<string | null>(() =>
    loadStorage<string | null>(PERSONA_STORAGE_KEY, null),
  );
  const [activeTab, setActiveTab] = useState<TabId>('form');

  useEffect(() => {
    const handleSelect = (e: Event) => {
      const name = (e as CustomEvent<string>).detail;
      saveStorage(PERSONA_STORAGE_KEY, name);
      setSelectedName(name);
      setActiveTab('form');
    };
    window.addEventListener('ravn:persona-selected', handleSelect);
    return () => window.removeEventListener('ravn:persona-selected', handleSelect);
  }, []);

  return (
    <div
      className="niuu-flex niuu-flex-col niuu-h-full niuu-overflow-hidden niuu-bg-bg-primary"
      data-testid="personas-page"
    >
      {selectedName ? (
        <PersonaDetailPane name={selectedName} activeTab={activeTab} onTabChange={setActiveTab} />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

function EmptyState() {
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
