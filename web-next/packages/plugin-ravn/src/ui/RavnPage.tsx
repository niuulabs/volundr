import { useState, useCallback } from 'react';
import { Rune } from '@niuulabs/ui';
import { OverviewPage } from './OverviewPage';
import { RavensPage } from './RavensPage';

export type RavnTab = 'overview' | 'ravens';

const TAB_STORAGE_KEY = 'ravn.tab';

const TABS: { id: RavnTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'ravens', label: 'Ravens' },
];

function loadTab(): RavnTab {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY);
    if (!raw) return 'overview';
    const parsed = JSON.parse(raw) as string;
    if (parsed === 'overview' || parsed === 'ravens') return parsed;
    return 'overview';
  } catch {
    return 'overview';
  }
}

export function RavnPage() {
  const [activeTab, setActiveTab] = useState<RavnTab>(loadTab);

  const handleTabChange = useCallback((tab: RavnTab) => {
    setActiveTab(tab);
    try {
      localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tab));
    } catch {
      // ignore
    }
  }, []);

  return (
    <div
      data-testid="ravn-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-bg-primary)',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-6)',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-primary)',
          flexShrink: 0,
        }}
      >
        <Rune glyph="ᚱ" size={24} />
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--text-base)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          Ravn · the flock
        </h2>

        <nav
          role="tablist"
          aria-label="Ravn navigation"
          style={{ display: 'flex', gap: 'var(--space-1)', marginLeft: 'var(--space-4)' }}
        >
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
              style={{
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: activeTab === tab.id ? 'var(--color-bg-tertiary)' : 'transparent',
                color:
                  activeTab === tab.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: 'var(--text-sm)',
                fontWeight: activeTab === tab.id ? 600 : 400,
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Tab panels */}
      <main
        id={`ravn-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`ravn-tab-${activeTab}`}
        style={{ flex: 1, overflow: 'hidden' }}
      >
        {activeTab === 'overview' && <OverviewPage />}
        {activeTab === 'ravens' && <RavensPage />}
      </main>
    </div>
  );
}
