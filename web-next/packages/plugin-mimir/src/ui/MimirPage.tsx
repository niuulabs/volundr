import { useState } from 'react';
import { Rune } from '@niuulabs/ui';
import { OverviewView } from './OverviewView';
import { PagesView } from './PagesView';
import { SourcesView } from './SourcesView';
import './MimirPage.css';
import './mimir-views.css';

type Tab = 'overview' | 'pages' | 'sources';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'pages', label: 'Pages' },
  { id: 'sources', label: 'Sources' },
];

export function MimirPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Page header ───────────────────────────────────────────── */}
      <div className="mimir-page__header" style={{ borderBottom: '1px solid var(--color-border-subtle)', padding: 'var(--space-4) var(--space-6)' }}>
        <Rune glyph="ᛗ" size={28} />
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Mímir</h2>
          <p className="mimir-page__subtitle" style={{ margin: 0 }}>the well of knowledge</p>
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────── */}
      <nav className="mm-tabs" aria-label="Mímir views" role="tablist">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`mimir-panel-${id}`}
            id={`mimir-tab-${id}`}
            className={`mm-tab${activeTab === id ? ' mm-tab--active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── View panels ───────────────────────────────────────────── */}
      <div
        id={`mimir-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`mimir-tab-${activeTab}`}
        style={{ flex: 1, overflow: 'auto' }}
      >
        {activeTab === 'overview' && <OverviewView />}
        {activeTab === 'pages' && <PagesView />}
        {activeTab === 'sources' && <SourcesView />}
      </div>
    </div>
  );
}
