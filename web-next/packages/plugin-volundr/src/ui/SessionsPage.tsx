import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Table, LoadingState, ErrorState, EmptyState, cn } from '@niuulabs/ui';
import { useSessionList } from './hooks/useSessionStore';
import { buildSessionColumns } from './utils/sessionColumns';
import { groupByState, SESSION_STATES } from './sessions/groupByState';
import type { SessionState } from '../domain/session';
import type { Session } from '../domain/session';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterCategory = 'status' | 'template' | 'cluster';

interface ActiveFilter {
  category: FilterCategory;
  value: string;
}

export interface SessionsPageProps {
  /** Optional Linear/tracker issue key shown in the page header (e.g. "NIU-123"). */
  issueKey?: string;
  /** URL for the issue link. Defaults to "#" when omitted. */
  issueUrl?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterSessions(
  sessions: Session[],
  activeFilter: ActiveFilter,
  searchQuery: string,
): Session[] {
  let filtered = sessions;

  if (activeFilter.category === 'status') {
    filtered = filtered.filter((s) => s.state === activeFilter.value);
  } else if (activeFilter.category === 'template') {
    filtered = filtered.filter((s) => s.templateId === activeFilter.value);
  } else if (activeFilter.category === 'cluster') {
    filtered = filtered.filter((s) => s.clusterId === activeFilter.value);
  }

  const q = searchQuery.trim().toLowerCase();
  if (!q) return filtered;

  return filtered.filter(
    (s) =>
      s.id.toLowerCase().includes(q) ||
      s.personaName.toLowerCase().includes(q) ||
      s.templateId.toLowerCase().includes(q),
  );
}

// ---------------------------------------------------------------------------
// SidebarSection
// ---------------------------------------------------------------------------

interface SidebarSectionProps {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  testId: string;
}

function SidebarSection({ label, collapsed, onToggle, children, testId }: SidebarSectionProps) {
  return (
    <div data-testid={testId}>
      <button
        type="button"
        onClick={onToggle}
        className="niuu-flex niuu-w-full niuu-items-center niuu-justify-between niuu-px-3 niuu-py-2 niuu-text-xs niuu-font-medium niuu-uppercase niuu-tracking-wider niuu-text-text-muted hover:niuu-text-text-secondary niuu-transition-colors"
        aria-expanded={!collapsed}
        data-testid={`${testId}-toggle`}
      >
        <span>{label}</span>
        <span
          className={cn(
            'niuu-text-text-muted niuu-transition-transform niuu-duration-150',
            collapsed ? 'niuu-rotate-0' : 'niuu-rotate-90',
          )}
          aria-hidden="true"
        >
          ›
        </span>
      </button>
      {!collapsed && <div role="group" aria-label={label}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarNode
// ---------------------------------------------------------------------------

interface SidebarNodeProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  testId: string;
}

function SidebarNode({ label, count, active, onClick, testId }: SidebarNodeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'niuu-flex niuu-w-full niuu-items-center niuu-justify-between niuu-border-l-2 niuu-px-3 niuu-py-1.5 niuu-text-sm niuu-transition-colors',
        active
          ? 'niuu-border-brand niuu-bg-brand-subtle niuu-text-brand'
          : 'niuu-border-transparent niuu-text-text-secondary hover:niuu-bg-bg-tertiary hover:niuu-text-text-primary',
      )}
      aria-pressed={active}
      data-testid={testId}
    >
      <span className="niuu-truncate">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            'niuu-ml-2 niuu-rounded-full niuu-px-1.5 niuu-py-0.5 niuu-text-xs niuu-font-medium niuu-tabular-nums',
            active
              ? 'niuu-bg-brand niuu-text-bg-primary'
              : 'niuu-bg-bg-elevated niuu-text-text-muted',
          )}
          data-testid={`${testId}-count`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SearchInput
// ---------------------------------------------------------------------------

interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
}

function SearchInput({ value, onChange }: SearchInputProps) {
  return (
    <div className="niuu-relative">
      <svg
        className="niuu-pointer-events-none niuu-absolute niuu-left-2.5 niuu-top-1/2 niuu--translate-y-1/2 niuu-text-text-muted"
        width="14"
        height="14"
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
        placeholder="Filter by name, ID, or template…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="niuu-w-full niuu-rounded niuu-border niuu-border-border-subtle niuu-bg-bg-tertiary niuu-py-1.5 niuu-pl-8 niuu-pr-3 niuu-text-sm niuu-text-text-primary placeholder:niuu-text-text-muted focus:niuu-outline-none focus:niuu-ring-1 focus:niuu-ring-brand"
        data-testid="session-search"
        aria-label="Filter sessions"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// IssueLinkIcon — external link icon
// ---------------------------------------------------------------------------

function IssueLinkIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="niuu-shrink-0"
    >
      <path
        d="M7.5 1.5H10.5V4.5M10.5 1.5L5 7M2.5 3H1.5C1.224 3 1 3.224 1 3.5V10.5C1 10.776 1.224 11 1.5 11H8.5C8.776 11 9 10.776 9 10.5V9.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// SessionsPage
// ---------------------------------------------------------------------------

/** Sessions page — left sidebar tree subnav + search + filterable session list. */
export function SessionsPage({ issueKey, issueUrl }: SessionsPageProps = {}) {
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>({
    category: 'status',
    value: 'running',
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<FilterCategory, boolean>>({
    status: false,
    template: false,
    cluster: false,
  });

  const navigate = useNavigate();
  const sessionsQuery = useSessionList();

  const allSessions = sessionsQuery.data ?? [];
  const grouped = sessionsQuery.data ? groupByState(sessionsQuery.data) : null;

  // Derive unique template IDs with counts
  const templateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of allSessions) {
      counts[s.templateId] = (counts[s.templateId] ?? 0) + 1;
    }
    return counts;
  }, [allSessions]);

  // Derive unique cluster IDs with counts
  const clusterCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of allSessions) {
      counts[s.clusterId] = (counts[s.clusterId] ?? 0) + 1;
    }
    return counts;
  }, [allSessions]);

  const visibleSessions = useMemo(
    () => filterSessions(allSessions, activeFilter, searchQuery),
    [allSessions, activeFilter, searchQuery],
  );

  function handleView(sessionId: string) {
    void navigate({ to: `/volundr/session/$sessionId`, params: { sessionId } });
  }

  const columns = buildSessionColumns({ onView: handleView });

  function toggleCollapse(category: FilterCategory) {
    setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }));
  }

  function selectFilter(category: FilterCategory, value: string) {
    setActiveFilter({ category, value });
  }

  const isActive = (category: FilterCategory, value: string) =>
    activeFilter.category === category && activeFilter.value === value;

  return (
    <div className="niuu-flex niuu-h-full" data-testid="sessions-page">
      {/* ── Left sidebar subnav ─────────────────────────────────── */}
      <nav
        className="niuu-flex niuu-w-60 niuu-shrink-0 niuu-flex-col niuu-overflow-y-auto niuu-border-r niuu-border-border-subtle niuu-bg-bg-secondary"
        aria-label="Session filters"
        data-testid="sessions-subnav"
      >
        {/* By Status */}
        <SidebarSection
          label="By Status"
          collapsed={collapsed.status}
          onToggle={() => toggleCollapse('status')}
          testId="section-status"
        >
          {SESSION_STATES.map((state) => {
            const count = grouped ? grouped[state].length : 0;
            return (
              <SidebarNode
                key={state}
                label={STATE_LABELS[state]}
                count={count}
                active={isActive('status', state)}
                onClick={() => selectFilter('status', state)}
                testId={`sidebar-node-status-${state}`}
              />
            );
          })}
        </SidebarSection>

        {/* By Template */}
        <SidebarSection
          label="By Template"
          collapsed={collapsed.template}
          onToggle={() => toggleCollapse('template')}
          testId="section-template"
        >
          {Object.entries(templateCounts).map(([templateId, count]) => (
            <SidebarNode
              key={templateId}
              label={templateId}
              count={count}
              active={isActive('template', templateId)}
              onClick={() => selectFilter('template', templateId)}
              testId={`sidebar-node-template-${templateId}`}
            />
          ))}
        </SidebarSection>

        {/* By Cluster */}
        <SidebarSection
          label="By Cluster"
          collapsed={collapsed.cluster}
          onToggle={() => toggleCollapse('cluster')}
          testId="section-cluster"
        >
          {Object.entries(clusterCounts).map(([clusterId, count]) => (
            <SidebarNode
              key={clusterId}
              label={clusterId}
              count={count}
              active={isActive('cluster', clusterId)}
              onClick={() => selectFilter('cluster', clusterId)}
              testId={`sidebar-node-cluster-${clusterId}`}
            />
          ))}
        </SidebarSection>
      </nav>

      {/* ── Main content ────────────────────────────────────────── */}
      <div className="niuu-flex niuu-min-w-0 niuu-flex-1 niuu-flex-col">
        {/* Page header */}
        <header className="niuu-flex niuu-items-center niuu-justify-between niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-px-4 niuu-py-2">
          <h2 className="niuu-text-sm niuu-font-semibold niuu-text-text-primary">Sessions</h2>
          {issueKey && (
            <a
              href={issueUrl ?? '#'}
              className="niuu-flex niuu-items-center niuu-gap-1 niuu-font-mono niuu-text-xs niuu-text-brand hover:niuu-underline"
              data-testid="issue-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              <IssueLinkIcon />
              {issueKey}
            </a>
          )}
        </header>

        {/* Search */}
        <div className="niuu-border-b niuu-border-border-subtle niuu-px-4 niuu-py-2">
          <SearchInput value={searchQuery} onChange={setSearchQuery} />
        </div>

        {/* Session list */}
        <div className="niuu-flex-1 niuu-overflow-auto niuu-p-4">
          {sessionsQuery.isLoading && <LoadingState label="Loading sessions…" />}

          {sessionsQuery.isError && (
            <ErrorState
              title="Failed to load sessions"
              message={
                sessionsQuery.error instanceof Error ? sessionsQuery.error.message : 'Unknown error'
              }
            />
          )}

          {sessionsQuery.data && visibleSessions.length === 0 && (
            <EmptyState
              title="No sessions match"
              description="Try a different filter or search query."
            />
          )}

          {sessionsQuery.data && visibleSessions.length > 0 && (
            <Table<Session>
              columns={columns}
              rows={visibleSessions}
              aria-label="Sessions"
            />
          )}
        </div>
      </div>
    </div>
  );
}
