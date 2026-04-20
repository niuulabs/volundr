import { useState } from 'react';
import { BudgetBar, StateDot } from '@niuulabs/ui';
import type { Ravn } from '../domain/ravn';
import type { BudgetState } from '@niuulabs/domain';
import { useTriggers } from './hooks/useTriggers';
import { useSessions } from './hooks/useSessions';
import { useMessages } from './hooks/useSessions';
import { useRavnBudget } from './hooks/useBudget';
import { ravnStatusToDotState } from './grouping';
import { loadStorage, saveStorage } from './storage';
import './RavnDetail.css';

const TAB_STORAGE_KEY = 'ravn.detail.tab';

type TabId = 'overview' | 'triggers' | 'activity' | 'sessions' | 'connectivity';

// ── Section components ──────────────────────────────────────────────────────

interface OverviewSectionProps {
  ravn: Ravn;
  budget: BudgetState | undefined;
}

function OverviewSection({ ravn, budget }: OverviewSectionProps) {
  const uptimeSince = new Date(ravn.createdAt).toLocaleString();

  return (
    <div className="rv-detail-overview">
      <dl className="rv-overview-dl">
        <dt>Persona</dt>
        <dd>{ravn.personaName}</dd>

        <dt>State</dt>
        <dd className="rv-overview-dd--state">
          <StateDot
            state={ravnStatusToDotState(ravn.status)}
            pulse={ravn.status === 'active'}
            size={8}
          />
          <span>{ravn.status}</span>
        </dd>

        <dt>Model</dt>
        <dd className="rv-overview-dd--model">{ravn.model}</dd>

        <dt>Since</dt>
        <dd className="rv-overview-dd--since">{uptimeSince}</dd>

        {ravn.location && (
          <>
            <dt>Location</dt>
            <dd className="rv-overview-dd--model">{ravn.location}</dd>
          </>
        )}
      </dl>

      {budget && (
        <div className="rv-overview-budget">
          <div className="rv-overview-budget__header">
            <span>Budget</span>
            <span className="rv-overview-budget__value">
              ${budget.spentUsd.toFixed(2)} / ${budget.capUsd.toFixed(2)}
            </span>
          </div>
          <BudgetBar
            spent={budget.spentUsd}
            cap={budget.capUsd}
            warnAt={Math.round(budget.warnAt * 100)}
            size="sm"
          />
        </div>
      )}

      {/* Danger zone */}
      <div className="rv-delete-actions" data-testid="danger-zone">
        <button
          type="button"
          className="rv-suspend-btn"
          data-testid="suspend-btn"
          disabled={ravn.status === 'suspended'}
        >
          {ravn.status === 'suspended' ? 'Already suspended' : 'Suspend ravn'}
        </button>

        <button type="button" className="rv-delete-btn" data-testid="delete-btn">
          Delete ravn
        </button>
      </div>
    </div>
  );
}

interface TriggersSectionProps {
  ravnPersonaName: string;
}

function TriggersSection({ ravnPersonaName }: TriggersSectionProps) {
  const { data: triggers } = useTriggers();
  const ravnTriggers = triggers?.filter((t) => t.personaName === ravnPersonaName) ?? [];

  return (
    <div data-testid="triggers-section-body">
      {ravnTriggers.length === 0 ? (
        <p className="rv-empty-text">No triggers configured</p>
      ) : (
        <ul className="rv-triggers-list">
          {ravnTriggers.map((t) => (
            <li key={t.id} className="rv-trigger-row" data-testid="trigger-row">
              <span className="rv-trigger-kind">{t.kind}</span>
              <span className="rv-trigger-spec">{t.spec}</span>
              <span className="rv-trigger-status" data-enabled={t.enabled}>
                {t.enabled ? 'on' : 'off'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ActivitySectionProps {
  ravnId: string;
}

function ActivitySection({ ravnId }: ActivitySectionProps) {
  const { data: sessions } = useSessions();
  const ravnSession = sessions?.find((s) => s.ravnId === ravnId);
  const { data: messages } = useMessages(ravnSession?.id ?? '');

  if (!ravnSession) {
    return <p className="rv-empty-text">No sessions for this ravn</p>;
  }

  return (
    <div data-testid="activity-section-body">
      <p className="rv-activity-session">
        Session {ravnSession.id.slice(0, 8)} — {ravnSession.status}
      </p>
      <div className="rv-activity-messages">
        {(messages ?? []).slice(-10).map((msg) => (
          <div
            key={msg.id}
            className="rv-activity-message"
            data-kind={msg.kind}
            data-testid="activity-message"
          >
            <span className="rv-activity-message__kind">[{msg.kind}] </span>
            {msg.content.slice(0, 80)}
            {msg.content.length > 80 ? '…' : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

interface SessionsSectionProps {
  ravnId: string;
}

function SessionsSection({ ravnId }: SessionsSectionProps) {
  const { data: sessions } = useSessions();
  const ravnSessions = sessions?.filter((s) => s.ravnId === ravnId) ?? [];

  return (
    <div data-testid="sessions-section-body">
      {ravnSessions.length === 0 ? (
        <p className="rv-empty-text">No sessions</p>
      ) : (
        <ul className="rv-sessions-list">
          {ravnSessions.map((s) => (
            <li key={s.id} className="rv-session-row" data-testid="session-row">
              <StateDot
                state={
                  s.status === 'running' ? 'running' : s.status === 'failed' ? 'failed' : 'unknown'
                }
                pulse={s.status === 'running'}
                size={8}
              />
              <span className="rv-session-id">{s.id.slice(0, 8)}</span>
              <span className="rv-session-status">{s.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ConnectivitySectionProps {
  ravn: Ravn;
}

function ConnectivitySection({ ravn }: ConnectivitySectionProps) {
  return (
    <div data-testid="connectivity-section-body">
      <p className="rv-connectivity-model">
        Model: <span className="rv-connectivity-model-value">{ravn.model}</span>
      </p>
      <p className="rv-connectivity-note">
        Event wiring is configured per-persona. View the{' '}
        <span className="rv-connectivity-note-emphasis">Events</span> tab for the full graph.
      </p>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export interface RavnDetailProps {
  ravn: Ravn;
  onClose?: () => void;
  className?: string;
}

export function RavnDetail({ ravn, onClose }: RavnDetailProps) {
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    loadStorage<TabId>(TAB_STORAGE_KEY, 'overview'),
  );

  const { data: budget } = useRavnBudget(ravn.id);
  const { data: triggers } = useTriggers();
  const { data: sessions } = useSessions();

  const triggerCount = triggers?.filter((t) => t.personaName === ravn.personaName).length ?? 0;
  const sessionCount = sessions?.filter((s) => s.ravnId === ravn.id).length ?? 0;
  const activityCount = sessionCount;

  const handleTabChange = (id: TabId) => {
    saveStorage(TAB_STORAGE_KEY, id);
    setActiveTab(id);
  };

  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'triggers', label: 'Triggers', count: triggerCount },
    { id: 'activity', label: 'Activity', count: activityCount },
    { id: 'sessions', label: 'Sessions', count: sessionCount },
    { id: 'connectivity', label: 'Connectivity' },
  ];

  return (
    <div data-testid="ravn-detail" className="rv-detail">
      {/* Header */}
      <div className="rv-detail__header">
        <span className="rv-detail__title">{ravn.personaName}</span>
        <StateDot
          state={ravnStatusToDotState(ravn.status)}
          pulse={ravn.status === 'active'}
          size={8}
        />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail pane"
            className="rv-detail__close"
            data-testid="detail-close-btn"
          >
            ✕
          </button>
        )}
      </div>

      {/* Tab nav */}
      <nav className="rv-sectabs" aria-label="Ravn detail sections" data-testid="ravn-sectabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`rv-sectab${activeTab === tab.id ? ' rv-sectab--active' : ''}`}
            data-testid={`sectab-${tab.id}`}
          >
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className="rv-sectabs-n">{tab.count}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Tab content */}
      <div className="rv-section__body" data-testid={`section-body-${activeTab}`}>
        {activeTab === 'overview' && <OverviewSection ravn={ravn} budget={budget} />}
        {activeTab === 'triggers' && <TriggersSection ravnPersonaName={ravn.personaName} />}
        {activeTab === 'activity' && <ActivitySection ravnId={ravn.id} />}
        {activeTab === 'sessions' && <SessionsSection ravnId={ravn.id} />}
        {activeTab === 'connectivity' && <ConnectivitySection ravn={ravn} />}
      </div>
    </div>
  );
}
