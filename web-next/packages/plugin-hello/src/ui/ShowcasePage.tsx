import { useState } from 'react';
import {
  Table,
  type ColumnDef,
  type SortState,
  FilterBar,
  FilterChip,
  FilterToggle,
  KpiCard,
  KpiStrip,
  EmptyState,
  LoadingState,
  ErrorState,
  StateDot,
  Chip,
} from '@niuulabs/ui';
import './ShowcasePage.css';

// ── Demo data ──────────────────────────────────────────────────────────────

interface Session {
  id: string;
  name: string;
  status: 'healthy' | 'failed' | 'idle' | 'running';
  score: number;
  region: string;
}

const SESSION_DATA: Session[] = [
  { id: 's1', name: 'session-alpha', status: 'healthy', score: 98, region: 'us-east' },
  { id: 's2', name: 'session-beta', status: 'running', score: 74, region: 'eu-west' },
  { id: 's3', name: 'session-gamma', status: 'idle', score: 61, region: 'us-west' },
  { id: 's4', name: 'session-delta', status: 'failed', score: 0, region: 'ap-south' },
];

const COLUMNS: ColumnDef<Session>[] = [
  {
    key: 'name',
    header: 'Session',
    cell: (r) => <code>{r.name}</code>,
    sortable: true,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => (
      <div className="niuu-showcase-status-cell">
        <StateDot state={r.status} />
        {r.status}
      </div>
    ),
  },
  {
    key: 'score',
    header: 'Score',
    cell: (r) => (
      <Chip tone={r.score > 80 ? 'brand' : r.score === 0 ? 'critical' : 'default'}>{r.score}</Chip>
    ),
    sortable: true,
  },
  { key: 'region', header: 'Region', cell: (r) => r.region },
];

// ── Page ───────────────────────────────────────────────────────────────────

type DataSurfaceState = 'loaded' | 'loading' | 'empty' | 'error';

export function ShowcasePage() {
  const [tableState, setTableState] = useState<DataSurfaceState>('loaded');
  const [sort, setSort] = useState<SortState>({ key: 'score', direction: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [pinned, setPinned] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const sortedRows = [...SESSION_DATA]
    .filter(
      (r) =>
        (!search || r.name.includes(search)) &&
        (!statusFilter || r.status === statusFilter) &&
        (!pinned || r.score > 80),
    )
    .sort((a, b) => {
      const dir = sort.direction === 'asc' ? 1 : -1;
      if (sort.key === 'score') return (a.score - b.score) * dir;
      return a.name.localeCompare(b.name) * dir;
    });

  return (
    <div className="niuu-showcase-page">
      <h2>Data Surfaces · Showcase</h2>

      {/* ── KPI Strip ──────────────────────────────────────── */}
      <section>
        <h3 className="niuu-showcase-section-title">KPI Strip</h3>
        <KpiStrip data-testid="kpi-strip">
          <KpiCard
            label="Active Sessions"
            value={142}
            delta={{ value: '+12', direction: 'up', label: 'vs yesterday' }}
          />
          <KpiCard label="Error Rate" value="2.4%" delta={{ value: '+0.8%', direction: 'down' }} />
          <KpiCard
            label="P99 Latency"
            value="120ms"
            delta={{ value: '0ms', direction: 'neutral' }}
          />
          <KpiCard
            label="Throughput"
            value="4.2k/s"
            delta={{ value: '+8%', direction: 'up' }}
            sparkline={
              <svg width="100%" height="32" viewBox="0 0 80 32" preserveAspectRatio="none">
                <polyline
                  points="0,28 10,22 20,25 30,10 40,15 50,8 60,12 70,5 80,3"
                  fill="none"
                  stroke="var(--brand-500)"
                  strokeWidth="1.5"
                />
              </svg>
            }
          />
        </KpiStrip>
      </section>

      {/* ── Filter Bar ─────────────────────────────────────── */}
      <section>
        <h3 className="niuu-showcase-section-title">Filter Bar</h3>
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search sessions…"
        >
          {statusFilter && (
            <FilterChip
              label="status"
              value={statusFilter}
              onRemove={() => setStatusFilter(undefined)}
            />
          )}
          <FilterToggle label="High score (>80)" active={pinned} onToggle={setPinned} />
          {!statusFilter && (
            <FilterToggle
              label="Show failed only"
              active={false}
              onToggle={(v) => setStatusFilter(v ? 'failed' : undefined)}
            />
          )}
        </FilterBar>
      </section>

      {/* ── Table ─────────────────────────────────────────── */}
      <section>
        <h3 className="niuu-showcase-section-title">
          Table
          <span className="niuu-showcase-state-btns">
            {(['loaded', 'loading', 'empty', 'error'] as DataSurfaceState[]).map((s) => (
              <button
                key={s}
                type="button"
                data-testid={`state-btn-${s}`}
                onClick={() => setTableState(s)}
                className={`niuu-showcase-state-btn${tableState === s ? ' niuu-showcase-state-btn--active' : ''}`}
              >
                {s}
              </button>
            ))}
          </span>
        </h3>

        {tableState === 'loading' && (
          <LoadingState
            title="Loading sessions…"
            description="Fetching latest data from the API."
          />
        )}
        {tableState === 'empty' && (
          <EmptyState
            icon="📭"
            title="No sessions found"
            description="Try adjusting your search or filters."
            action={
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStatusFilter(undefined);
                  setPinned(false);
                }}
                className="niuu-showcase-action-btn"
              >
                Clear filters
              </button>
            }
          />
        )}
        {tableState === 'error' && (
          <ErrorState
            title="Failed to load sessions"
            description="Error: connect ECONNREFUSED 127.0.0.1:8080"
            action={
              <button type="button" className="niuu-showcase-action-btn--danger">
                ↻ Retry
              </button>
            }
          />
        )}
        {tableState === 'loaded' && (
          <Table
            columns={COLUMNS}
            rows={sortedRows}
            getRowKey={(r) => r.id}
            sortState={sort}
            onSortChange={setSort}
            selectable
            selectedKeys={selected}
            onSelectionChange={setSelected}
            expandedKeys={expanded}
            onExpandChange={setExpanded}
            renderExpanded={(r) => (
              <div className="niuu-showcase-expanded-row">
                Session ID: <code>{r.id}</code> · Region: {r.region} · Score: {r.score}
              </div>
            )}
            stickyHeader
            emptyState={
              <EmptyState
                title="No sessions match the current filters"
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setStatusFilter(undefined);
                      setPinned(false);
                    }}
                    className="niuu-showcase-clear-btn"
                  >
                    Clear
                  </button>
                }
              />
            }
            aria-label="Sessions table"
          />
        )}
      </section>
    </div>
  );
}
