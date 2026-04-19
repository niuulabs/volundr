import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Table, LifecycleBadge, LoadingState, ErrorState, EmptyState } from '@niuulabs/ui';
import type { TableColumn } from '@niuulabs/ui';
import { useSessionList } from './hooks/useSessionStore';
import { groupByState, SESSION_STATES } from './sessions/groupByState';
import type { SessionState } from '../domain/session';
import type { Session } from '../domain/session';

const STATE_LABELS: Record<SessionState, string> = {
  requested: 'Requested',
  provisioning: 'Provisioning',
  ready: 'Ready',
  running: 'Running',
  idle: 'Idle',
  terminating: 'Terminating',
  terminated: 'Terminated',
  failed: 'Failed',
};

function lifecycleBadgeState(
  state: SessionState,
): 'provisioning' | 'running' | 'idle' | 'terminating' | 'terminated' | 'failed' | 'ready' {
  if (state === 'requested') return 'provisioning';
  return state as
    | 'provisioning'
    | 'running'
    | 'idle'
    | 'terminating'
    | 'terminated'
    | 'failed'
    | 'ready';
}

type SessionRow = Session & { id: string };

function buildColumns(
  onView: (id: string) => void,
): TableColumn<SessionRow>[] {
  return [
    {
      key: 'id',
      header: 'Session',
      render: (s) => (
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-primary">{s.id}</span>
      ),
    },
    {
      key: 'persona',
      header: 'Persona',
      render: (s) => (
        <span className="niuu-text-sm niuu-text-text-secondary">{s.personaName}</span>
      ),
    },
    {
      key: 'cluster',
      header: 'Cluster',
      render: (s) => (
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">{s.clusterId}</span>
      ),
    },
    {
      key: 'state',
      header: 'State',
      render: (s) => <LifecycleBadge state={lifecycleBadgeState(s.state)} />,
    },
    {
      key: 'started',
      header: 'Started',
      render: (s) => (
        <span className="niuu-font-mono niuu-text-xs niuu-text-text-muted">
          {new Date(s.startedAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (s) => (
        <button
          className="niuu-rounded niuu-px-2 niuu-py-1 niuu-text-xs niuu-text-brand hover:niuu-bg-bg-elevated"
          onClick={() => onView(s.id)}
          data-testid={`view-session-${s.id}`}
          aria-label={`View session ${s.id}`}
        >
          View →
        </button>
      ),
    },
  ];
}

/** Sessions page — state-grouped subnav + filterable session list. */
export function SessionsPage() {
  const [activeState, setActiveState] = useState<SessionState>('running');
  const navigate = useNavigate();

  const sessionsQuery = useSessionList();

  const grouped = sessionsQuery.data ? groupByState(sessionsQuery.data) : null;
  const visibleSessions = grouped ? (grouped[activeState] as SessionRow[]) : [];

  function handleView(sessionId: string) {
    void navigate({ to: `/volundr/session/$sessionId`, params: { sessionId } });
  }

  const columns = buildColumns(handleView);

  return (
    <div className="niuu-flex niuu-h-full niuu-flex-col" data-testid="sessions-page">
      {/* State subnav */}
      <div
        className="niuu-flex niuu-items-center niuu-gap-0 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4"
        role="tablist"
        aria-label="Session state filter"
      >
        {SESSION_STATES.map((state) => {
          const count = grouped ? grouped[state].length : 0;
          const isActive = activeState === state;
          return (
            <button
              key={state}
              role="tab"
              aria-selected={isActive}
              data-testid={`state-tab-${state}`}
              onClick={() => setActiveState(state)}
              className={
                isActive
                  ? 'niuu-flex niuu-items-center niuu-gap-1.5 niuu-border-b-2 niuu-border-brand niuu-px-4 niuu-py-2.5 niuu-text-sm niuu-font-medium niuu-text-brand'
                  : 'niuu-flex niuu-items-center niuu-gap-1.5 niuu-border-b-2 niuu-border-transparent niuu-px-4 niuu-py-2.5 niuu-text-sm niuu-text-text-muted hover:niuu-text-text-secondary'
              }
            >
              {STATE_LABELS[state]}
              {count > 0 && (
                <span
                  className={
                    isActive
                      ? 'niuu-rounded-full niuu-bg-brand niuu-px-1.5 niuu-py-0.5 niuu-text-xs niuu-font-medium niuu-text-bg-primary'
                      : 'niuu-rounded-full niuu-bg-bg-elevated niuu-px-1.5 niuu-py-0.5 niuu-text-xs niuu-text-text-muted'
                  }
                  data-testid={`state-count-${state}`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Session list */}
      <div className="niuu-flex-1 niuu-overflow-auto niuu-p-4">
        {sessionsQuery.isLoading && <LoadingState label="Loading sessions…" />}

        {sessionsQuery.isError && (
          <ErrorState
            title="Failed to load sessions"
            message={
              sessionsQuery.error instanceof Error
                ? sessionsQuery.error.message
                : 'Unknown error'
            }
          />
        )}

        {grouped && visibleSessions.length === 0 && (
          <EmptyState
            title={`No ${STATE_LABELS[activeState].toLowerCase()} sessions`}
            description={`Sessions in the ${STATE_LABELS[activeState].toLowerCase()} state will appear here.`}
          />
        )}

        {grouped && visibleSessions.length > 0 && (
          <Table<SessionRow>
            columns={columns}
            rows={visibleSessions}
            aria-label={`${STATE_LABELS[activeState]} sessions`}
          />
        )}
      </div>
    </div>
  );
}
