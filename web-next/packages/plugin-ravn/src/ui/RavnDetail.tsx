import { useState, useCallback } from 'react';
import { BudgetBar, StateDot } from '@niuulabs/ui';
import type { Ravn } from '../domain/ravn';
import type { BudgetState } from '@niuulabs/domain';
import { useTriggers } from './hooks/useTriggers';
import { useSessions } from './hooks/useSessions';
import { useMessages } from './hooks/useSessions';
import { useRavnBudget } from './hooks/useBudget';

const SECTIONS_STORAGE_KEY = 'ravn.detail.sections.collapsed';

const DEFAULT_SECTIONS: SectionId[] = ['overview'];

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

function loadCollapsedSections(): Set<SectionId> {
  try {
    const raw = localStorage.getItem(SECTIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as SectionId[];
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function saveCollapsedSections(collapsed: Set<SectionId>): void {
  try {
    localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(Array.from(collapsed)));
  } catch {
    // ignore storage errors
  }
}

interface CollapsibleSectionProps {
  id: SectionId;
  label: string;
  collapsed: boolean;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}

function CollapsibleSection({ id, label, collapsed, onToggle, children }: CollapsibleSectionProps) {
  return (
    <div
      data-testid={`ravn-detail-section-${id}`}
      style={{
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={`section-body-${id}`}
        onClick={() => onToggle(id)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-primary)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
        }}
        data-testid={`section-toggle-${id}`}
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
          }}
        >
          ▾
        </span>
      </button>

      {!collapsed && (
        <div
          id={`section-body-${id}`}
          style={{ padding: 'var(--space-2) var(--space-4) var(--space-4)' }}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: 'var(--space-1) var(--space-4)',
          margin: 0,
          fontSize: 'var(--text-sm)',
        }}
      >
        <dt style={{ color: 'var(--color-text-muted)' }}>Persona</dt>
        <dd style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 500 }}>
          {ravn.personaName}
        </dd>

        <dt style={{ color: 'var(--color-text-muted)' }}>State</dt>
        <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot
            state={
              ravn.status === 'active'
                ? 'running'
                : ravn.status === 'suspended'
                  ? 'attention'
                  : ravn.status === 'failed'
                    ? 'failed'
                    : 'unknown'
            }
            pulse={ravn.status === 'active'}
            size={8}
          />
          <span style={{ color: 'var(--color-text-primary)' }}>{ravn.status}</span>
        </dd>

        <dt style={{ color: 'var(--color-text-muted)' }}>Model</dt>
        <dd
          style={{
            margin: 0,
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
          }}
        >
          {ravn.model}
        </dd>

        <dt style={{ color: 'var(--color-text-muted)' }}>Since</dt>
        <dd style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
          {uptimeSince}
        </dd>
      </dl>

      {budget && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
            }}
          >
            <span>Budget</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
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
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
          No triggers configured
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {ravnTriggers.map((t) => (
            <li
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                fontSize: 'var(--text-sm)',
                padding: 'var(--space-1) 0',
              }}
              data-testid="trigger-row"
            >
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  padding: '1px var(--space-2)',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--color-bg-tertiary)',
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {t.kind}
              </span>
              <span
                style={{
                  flex: 1,
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                }}
              >
                {t.spec}
              </span>
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  color: t.enabled ? 'var(--color-accent-emerald)' : 'var(--color-text-muted)',
                }}
              >
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
    return (
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
        No sessions for this ravn
      </p>
    );
  }

  return (
    <div data-testid="activity-section-body">
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 0 }}>
        Session {ravnSession.id.slice(0, 8)} — {ravnSession.status}
      </p>
      <div
        style={{
          maxHeight: 200,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
        }}
      >
        {(messages ?? []).slice(-10).map((msg) => (
          <div
            key={msg.id}
            style={{
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
              color:
                msg.kind === 'user' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              paddingLeft: msg.kind !== 'user' ? 'var(--space-3)' : 0,
            }}
            data-testid="activity-message"
          >
            <span style={{ color: 'var(--color-text-muted)' }}>[{msg.kind}] </span>
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
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
          No sessions
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {ravnSessions.map((s) => (
            <li
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                fontSize: 'var(--text-sm)',
              }}
              data-testid="session-row"
            >
              <StateDot
                state={
                  s.status === 'running' ? 'running' : s.status === 'failed' ? 'failed' : 'unknown'
                }
                pulse={s.status === 'running'}
                size={8}
              />
              <span
                style={{
                  flex: 1,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {s.id.slice(0, 8)}
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                {s.status}
              </span>
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
      <p
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          margin: '0 0 var(--space-2)',
        }}
      >
        Model:{' '}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)' }}>
          {ravn.model}
        </span>
      </p>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
        Event wiring is configured per-persona. View the{' '}
        <span style={{ color: 'var(--color-text-secondary)' }}>Events</span> tab for the full graph.
      </p>
    </div>
  );
}

interface DeleteSectionProps {
  ravn: Ravn;
}

function DeleteSection({ ravn }: DeleteSectionProps) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
      data-testid="delete-section-body"
    >
      <button
        type="button"
        style={{
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-tertiary)',
          color: 'var(--color-text-primary)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
        }}
        data-testid="suspend-btn"
        disabled={ravn.status === 'suspended'}
      >
        {ravn.status === 'suspended' ? 'Already suspended' : 'Suspend ravn'}
      </button>

      <button
        type="button"
        style={{
          padding: 'var(--space-2) var(--space-4)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-accent-red)',
          background: 'color-mix(in srgb, var(--color-accent-red) 10%, transparent)',
          color: 'var(--color-accent-red)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
        }}
        data-testid="delete-btn"
      >
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
    const stored = loadCollapsedSections();
    // By default expand 'overview'; collapse everything else unless stored
    const initial = new Set<SectionId>(ALL_SECTIONS.filter((s) => !DEFAULT_SECTIONS.includes(s)));
    // Apply stored preferences
    for (const section of ALL_SECTIONS) {
      if (stored.has(section)) {
        initial.add(section);
      } else if (!DEFAULT_SECTIONS.includes(section) && !stored.size) {
        // keep default
      } else if (!stored.has(section) && stored.size > 0) {
        initial.delete(section);
      }
    }
    return initial;
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
      saveCollapsedSections(next);
      return next;
    });
  }, []);

  return (
    <div
      data-testid="ravn-detail"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--color-bg-secondary)',
        borderLeft: '1px solid var(--color-border)',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
          position: 'sticky',
          top: 0,
          background: 'var(--color-bg-secondary)',
          zIndex: 1,
        }}
      >
        <span style={{ fontSize: 'var(--text-lg)', flex: 1, fontWeight: 600 }}>
          {ravn.personaName}
        </span>
        <StateDot
          state={
            ravn.status === 'active'
              ? 'running'
              : ravn.status === 'suspended'
                ? 'attention'
                : ravn.status === 'failed'
                  ? 'failed'
                  : 'unknown'
          }
          pulse={ravn.status === 'active'}
          size={8}
        />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail pane"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-base)',
              padding: 'var(--space-1)',
              lineHeight: 1,
            }}
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
