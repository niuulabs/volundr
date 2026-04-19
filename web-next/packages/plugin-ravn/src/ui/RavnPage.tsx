/**
 * RavnPage — the main Ravn plugin page with five sub-views.
 *
 * Tabs: Sessions | Triggers | Events | Budget | Log
 */

import { useState } from 'react';
import { Rune } from '@niuulabs/ui';
import { SessionsView } from './SessionsView';
import { TriggersView } from './TriggersView';
import { EventsView } from './EventsView';
import { BudgetView } from './BudgetView';
import { LogView } from './LogView';
import './ravn-views.css';

type Tab = 'sessions' | 'triggers' | 'events' | 'budget' | 'log';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'triggers', label: 'Triggers' },
  { id: 'events', label: 'Events' },
  { id: 'budget', label: 'Budget' },
  { id: 'log', label: 'Log' },
];

export function RavnPage() {
  const [activeTab, setActiveTab] = useState<Tab>('sessions');

  return (
    <div className="rv-page-shell">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="rv-page-header">
        <Rune glyph="ᚱ" size={28} />
        <div>
          <h2>Ravn</h2>
          <p className="rv-page-subtitle">
            personas · ravens · sessions · triggers · events · budget · log
          </p>
        </div>
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────── */}
      <nav className="rv-tabs" aria-label="Ravn views" role="tablist">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`ravn-panel-${id}`}
            id={`ravn-tab-${id}`}
            className={`rv-tab${activeTab === id ? ' rv-tab--active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── View panels ──────────────────────────────────────────────── */}
      <div
        id={`ravn-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`ravn-tab-${activeTab}`}
        className="rv-tabpanel"
      >
        {activeTab === 'sessions' && <SessionsView />}
        {activeTab === 'triggers' && <TriggersView />}
        {activeTab === 'events' && <EventsView />}
        {activeTab === 'budget' && <BudgetView />}
        {activeTab === 'log' && <LogView />}
      </div>
    </div>
  );
}
