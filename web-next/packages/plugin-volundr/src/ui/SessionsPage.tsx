import { useEffect, useMemo, useState } from 'react';
import { LoadingState, ErrorState, EmptyState, StateDot, relTime, cn } from '@niuulabs/ui';
import type { DotState } from '@niuulabs/ui';
import { useSessionList } from './hooks/useSessionStore';
import { groupByState } from './sessions/groupByState';
import { ConnectionTypeBadge } from './atoms';
import { SessionDetailPage } from './SessionDetailPage';
import type { Session, SessionState } from '../domain/session';

// ---------------------------------------------------------------------------
// Pod group definitions — maps display labels to session states
// ---------------------------------------------------------------------------

interface PodGroupDef {
  label: string;
  states: SessionState[];
}

const POD_GROUPS: PodGroupDef[] = [
  { label: 'ACTIVE', states: ['running'] },
  { label: 'IDLE', states: ['idle'] },
  { label: 'BOOTING', states: ['provisioning', 'requested'] },
  { label: 'ERROR', states: ['failed'] },
  { label: 'STOPPED', states: ['terminated'] },
];

// ---------------------------------------------------------------------------
// Session state → dot state mapping
// ---------------------------------------------------------------------------

const SESSION_DOT: Record<SessionState, DotState> = {
  running: 'running',
  idle: 'idle',
  provisioning: 'processing',
  requested: 'queued',
  ready: 'healthy',
  terminating: 'degraded',
  terminated: 'archived',
  failed: 'failed',
};

// ---------------------------------------------------------------------------
// PodEntry — a single session row in the sidebar
// ---------------------------------------------------------------------------

function PodEntry({
  session,
  selected,
  onSelect,
  collapsed = false,
}: {
  session: Session;
  selected: boolean;
  onSelect: () => void;
  collapsed?: boolean;
}) {
  const ageLabel = relTime(new Date(session.lastActivityAt ?? session.startedAt).getTime());
  const primaryLabel = session.personaName || session.id;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`pod-entry-${session.id}`}
      className={cn(
        'niuu-flex niuu-w-full niuu-items-start niuu-gap-3 niuu-border-l-2 niuu-px-4 niuu-py-2.5 niuu-text-left niuu-transition-colors',
        selected
          ? 'niuu-border-brand niuu-bg-[#12212b]'
          : 'niuu-border-transparent hover:niuu-bg-bg-tertiary',
      )}
    >
      <StateDot state={SESSION_DOT[session.state]} pulse={session.state === 'running'} />
      {collapsed ? null : (
      <div className="niuu-flex-1 niuu-min-w-0 niuu-flex niuu-flex-col niuu-gap-0.5">
        <div className="niuu-font-mono niuu-text-[14px] niuu-font-medium niuu-text-text-primary niuu-truncate">
          {primaryLabel}
        </div>
        <div className="niuu-font-mono niuu-text-[10px] niuu-text-text-muted niuu-truncate">
          {session.id} · {ageLabel}
        </div>
      </div>
      )}
      {session.connectionType && (
        <div className="niuu-flex niuu-h-8 niuu-w-8 niuu-items-center niuu-justify-center niuu-rounded-md niuu-bg-bg-elevated">
          <ConnectionTypeBadge connectionType={session.connectionType} />
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PodGroup — a state section with label + session entries
// ---------------------------------------------------------------------------

function PodGroup({
  label,
  sessions,
  selectedId,
  onSelect,
  collapsed = false,
}: {
  label: string;
  sessions: Session[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed?: boolean;
}) {
  if (sessions.length === 0) return null;

  return (
    <div data-testid={`pod-group-${label.toLowerCase()}`}>
      {!collapsed && (
      <div className="niuu-flex niuu-items-center niuu-justify-between niuu-px-5 niuu-py-3 niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-[0.18em] niuu-text-text-muted">
        <span>{label}</span>
        <span className="niuu-font-mono niuu-text-text-faint" data-testid={`pod-group-${label.toLowerCase()}-count`}>
          {sessions.length}
        </span>
      </div>
      )}
      {sessions.map((s) => (
        <PodEntry
          key={s.id}
          session={s}
          selected={s.id === selectedId}
          onSelect={() => onSelect(s.id)}
          collapsed={collapsed}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionsPage — master-detail layout
// ---------------------------------------------------------------------------

export function SessionsPage() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const sessionsQuery = useSessionList();
  const allSessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);

  // Filter by search query
  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allSessions;
    return allSessions.filter(
      (s) => s.id.toLowerCase().includes(q) || s.personaName.toLowerCase().includes(q),
    );
  }, [allSessions, searchQuery]);

  // Group by state
  const grouped = useMemo(() => groupByState(filteredSessions), [filteredSessions]);

  // Build sidebar groups — flatten matching states per display group
  const sidebarGroups = useMemo(
    () =>
      POD_GROUPS.map((g) => ({
        label: g.label,
        sessions: g.states.flatMap((st) => grouped[st]),
      })),
    [grouped],
  );

  // Auto-select first running session on load
  useEffect(() => {
    if (selectedSessionId) return;
    if (!sessionsQuery.data) return;
    const running = sessionsQuery.data.filter((s) => s.state === 'running');
    if (running.length > 0) {
      setSelectedSessionId(running[0]!.id);
    } else if (sessionsQuery.data.length > 0) {
      setSelectedSessionId(sessionsQuery.data[0]!.id);
    }
  }, [sessionsQuery.data, selectedSessionId]);

  return (
    <div className="niuu-relative niuu-flex niuu-h-full" data-testid="sessions-page">
      {/* ── Left sidebar: pod list ─────────────────────────────── */}
      <nav
        className={cn(
          'niuu-relative niuu-shrink-0 niuu-overflow-hidden niuu-border-r niuu-border-border-subtle niuu-bg-[#0b0c10] niuu-transition-[width] niuu-duration-200',
          sidebarCollapsed ? 'niuu-w-[54px]' : 'niuu-w-[272px]',
        )}
        aria-label="Session list"
        data-testid="pod-list-sidebar"
      >
        {sidebarCollapsed ? (
          <div className="niuu-flex niuu-h-full niuu-flex-col niuu-overflow-hidden">
            <div className="niuu-flex niuu-items-center niuu-justify-center niuu-border-b niuu-border-border-subtle niuu-py-3">
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="niuu-font-mono niuu-text-sm niuu-text-text-muted"
                data-testid="pod-sidebar-toggle"
                aria-label="Expand pods sidebar"
              >
                ›
              </button>
            </div>
            <div className="niuu-flex-1 niuu-overflow-y-auto niuu-py-3">
              {sidebarGroups.map((g) => (
                <PodGroup
                  key={g.label}
                  label={g.label}
                  sessions={g.sessions}
                  selectedId={selectedSessionId}
                  onSelect={setSelectedSessionId}
                  collapsed
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="niuu-flex niuu-h-full niuu-flex-col niuu-overflow-hidden">
            <div className="niuu-flex niuu-items-center niuu-justify-between niuu-border-b niuu-border-border-subtle niuu-px-4 niuu-py-3">
              <div className="niuu-flex niuu-items-baseline niuu-gap-2">
                <h2 className="niuu-text-sm niuu-font-semibold niuu-text-text-primary">Sessions</h2>
                <span
                  className="niuu-rounded-full niuu-bg-bg-elevated niuu-px-1.5 niuu-py-0.5 niuu-font-mono niuu-text-[10px] niuu-text-text-muted"
                  data-testid="pod-count"
                >
                  {allSessions.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                className="niuu-font-mono niuu-text-lg niuu-text-text-muted"
                data-testid="pod-sidebar-toggle"
                aria-label="Collapse pods sidebar"
              >
                ‹
              </button>
            </div>

            <div className="niuu-px-4 niuu-pb-3">
              <p className="niuu-text-[10px] niuu-font-mono niuu-text-text-faint">
                filter in header · click to open
              </p>
            </div>

            <div className="niuu-px-4 niuu-py-2">
              <div className="niuu-relative">
                <svg
                  className="niuu-pointer-events-none niuu-absolute niuu-left-2 niuu-top-1/2 niuu--translate-y-1/2 niuu-text-text-muted"
                  width="12"
                  height="12"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.25" />
                  <path
                    d="M10 10L12.5 12.5"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  type="search"
                  placeholder="filter by name / branch /"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="niuu-w-full niuu-rounded niuu-border niuu-border-border-subtle niuu-bg-bg-tertiary niuu-py-1.5 niuu-pl-7 niuu-pr-2 niuu-text-[11px] niuu-text-text-primary placeholder:niuu-text-text-muted focus:niuu-outline-none focus:niuu-ring-1 focus:niuu-ring-brand"
                  data-testid="pod-search"
                  aria-label="Filter sessions"
                />
              </div>
            </div>

            <div className="niuu-flex-1 niuu-overflow-y-auto">
              {sidebarGroups.map((g) => (
                <PodGroup
                  key={g.label}
                  label={g.label}
                  sessions={g.sessions}
                  selectedId={selectedSessionId}
                  onSelect={setSelectedSessionId}
                />
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* ── Main content: session detail ───────────────────────── */}
      <div className="niuu-flex niuu-min-w-0 niuu-flex-1 niuu-flex-col niuu-overflow-hidden">
        {sessionsQuery.isLoading && <LoadingState label="Loading sessions…" />}
        {sessionsQuery.isError && (
          <ErrorState
            title="Failed to load sessions"
            message={
              sessionsQuery.error instanceof Error ? sessionsQuery.error.message : 'Unknown error'
            }
          />
        )}
        {sessionsQuery.data && !selectedSessionId && (
          <EmptyState title="No session selected" description="Select a session from the sidebar." />
        )}
        {sessionsQuery.data && selectedSessionId && (
          <SessionDetailPage key={selectedSessionId} sessionId={selectedSessionId} />
        )}
      </div>
    </div>
  );
}
