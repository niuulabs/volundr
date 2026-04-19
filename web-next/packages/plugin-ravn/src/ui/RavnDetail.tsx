import { useState, useCallback } from 'react';
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

const SECTIONS_STORAGE_KEY = 'ravn.detail.sections.collapsed';

const INITIALLY_EXPANDED_SECTIONS: SectionId[] = ['overview'];

type SectionId = 'overview' | 'triggers' | 'activity' | 'sessions' | 'connectivity' | 'delete';

const SECTION_LABELS: Record<SectionId, string> = {
  overview: 'Overview',
  triggers: 'Triggers',
  activity: 'Activity',
  sessions: 'Sessions',
  connectivity: 'Connectivity',
  delete: 'Delete / Suspend',
};

const ALL_SECTIONS: SectionId[] = [
  'overview',
  'triggers',
  'activity',
  'sessions',
  'connectivity',
  'delete',
];

interface CollapsibleSectionProps {
  id: SectionId;
  label: string;
  collapsed: boolean;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}

function CollapsibleSection({ id, label, collapsed, onToggle, children }: CollapsibleSectionProps) {
  return (
    <div data-testid={`ravn-detail-section-${id}`} className="rv-section">
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={`section-body-${id}`}
        onClick={() => onToggle(id)}
        className="rv-section__toggle"
        data-testid={`section-toggle-${id}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="rv-section__chevron">
          ▾
        </span>
      </button>

      {!collapsed && (
        <div
          id={`section-body-${id}`}
          className="rv-section__body"
          data-testid={`section-body-${id}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

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

interface DeleteSectionProps {
  ravn: Ravn;
}

function DeleteSection({ ravn }: DeleteSectionProps) {
  return (
    <div className="rv-delete-actions" data-testid="delete-section-body">
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
  );
}

export interface RavnDetailProps {
  ravn: Ravn;
  onClose?: () => void;
  className?: string;
}

export function RavnDetail({ ravn, onClose }: RavnDetailProps) {
  const [collapsed, setCollapsed] = useState<Set<SectionId>>(() => {
    const stored = loadStorage<SectionId[]>(SECTIONS_STORAGE_KEY, []);
    if (stored.length > 0) return new Set(stored);
    return new Set(ALL_SECTIONS.filter((s) => !INITIALLY_EXPANDED_SECTIONS.includes(s)));
  });

  const { data: budget } = useRavnBudget(ravn.id);

  const handleToggle = useCallback((id: SectionId) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveStorage(SECTIONS_STORAGE_KEY, Array.from(next));
      return next;
    });
  }, []);

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

      {/* Sections */}
      {ALL_SECTIONS.map((id) => (
        <CollapsibleSection
          key={id}
          id={id}
          label={SECTION_LABELS[id]}
          collapsed={collapsed.has(id)}
          onToggle={handleToggle}
        >
          {id === 'overview' && <OverviewSection ravn={ravn} budget={budget} />}
          {id === 'triggers' && <TriggersSection ravnPersonaName={ravn.personaName} />}
          {id === 'activity' && <ActivitySection ravnId={ravn.id} />}
          {id === 'sessions' && <SessionsSection ravnId={ravn.id} />}
          {id === 'connectivity' && <ConnectivitySection ravn={ravn} />}
          {id === 'delete' && <DeleteSection ravn={ravn} />}
        </CollapsibleSection>
      ))}
    </div>
  );
}
