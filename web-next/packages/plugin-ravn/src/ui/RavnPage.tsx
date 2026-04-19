import { useState, useCallback } from 'react';
import { Rune } from '@niuulabs/ui';
import { OverviewPage } from './OverviewPage';
import { RavensPage } from './RavensPage';
import { loadStorage, saveStorage } from './storage';
import './RavnPage.css';

export type RavnTab = 'overview' | 'ravens';

const TAB_STORAGE_KEY = 'ravn.tab';

const TABS: { id: RavnTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'ravens', label: 'Ravens' },
];

export function RavnPage() {
  const [activeTab, setActiveTab] = useState<RavnTab>(() =>
    loadStorage<RavnTab>(TAB_STORAGE_KEY, 'overview'),
  );

  const handleTabChange = useCallback((tab: RavnTab) => {
    setActiveTab(tab);
    saveStorage(TAB_STORAGE_KEY, tab);
  }, []);

  return (
    <div data-testid="ravn-page" className="rv-page">
      <header className="rv-page__header">
        <Rune glyph="ᚱ" size={24} />
        <h2 className="rv-page__title">Ravn · the flock</h2>

        <nav role="tablist" aria-label="Ravn navigation" className="rv-page__tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`ravn-panel-${tab.id}`}
              id={`ravn-tab-${tab.id}`}
              onClick={() => handleTabChange(tab.id)}
              data-testid={`ravn-tab-${tab.id}`}
              className="rv-page-tab"
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main
        id={`ravn-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`ravn-tab-${activeTab}`}
        className="rv-page__panel"
      >
        {activeTab === 'overview' && <OverviewPage />}
        {activeTab === 'ravens' && <RavensPage />}
      </main>
    </div>
  );
}
