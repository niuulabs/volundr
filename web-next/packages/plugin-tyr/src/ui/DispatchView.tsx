import { useMemo, useState } from 'react';
import { useService } from '@niuulabs/plugin-sdk';
import {
  Table,
  type TableColumn,
  StateDot,
  StatusBadge,
  ConfidenceBar,
  Tooltip,
  TooltipProvider,
} from '@niuulabs/ui';
import { cn } from '@niuulabs/ui';
import type { IDispatchBus } from '../ports';
import type { RaidStatus } from '../domain/saga';
import {
  checkFeasibility,
  type FeasibilityGate,
  type FeasibilityResult,
} from '../application/dispatch-feasibility';
import { useDispatcherState } from './useDispatcherState';
import { useDispatchQueue, type DispatchEntry } from './useDispatchQueue';

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type StatusFilter = 'all' | 'ready' | 'blocked' | 'queue';

const FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  ready: 'Ready',
  blocked: 'Blocked',
  queue: 'Queue',
};

const QUEUE_STATUSES: RaidStatus[] = ['queued', 'running'];
const TERMINAL_STATUSES: RaidStatus[] = ['merged', 'failed', 'review', 'escalated'];

// ---------------------------------------------------------------------------
// Enriched entry
// ---------------------------------------------------------------------------

interface EnrichedEntry extends DispatchEntry {
  feasibility: FeasibilityResult;
  effectiveStatus: RaidStatus;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RuleCard({
  threshold,
  maxConcurrentRaids,
  autoContinue,
}: {
  threshold: number;
  maxConcurrentRaids: number;
  autoContinue: boolean;
}) {
  return (
    <div
      className="niuu-rounded-lg niuu-border niuu-border-border niuu-bg-bg-secondary niuu-p-4 niuu-mb-4"
      aria-label="Dispatch rules"
    >
      <div className="niuu-flex niuu-items-center niuu-justify-between niuu-mb-3">
        <h3 className="niuu-m-0 niuu-text-sm niuu-font-semibold niuu-text-text-primary">
          Dispatch rules
        </h3>
      </div>
      <dl className="niuu-grid niuu-gap-x-8 niuu-gap-y-1 niuu-text-xs niuu-text-text-secondary niuu-m-0"
        style={{ gridTemplateColumns: 'repeat(4, auto)' }}
      >
        <dt className="niuu-text-text-muted">Confidence threshold</dt>
        <dt className="niuu-text-text-muted">Concurrent cap</dt>
        <dt className="niuu-text-text-muted">Auto-continue</dt>
        <dt className="niuu-text-text-muted">Retries</dt>
        <dd className="niuu-m-0 niuu-font-mono niuu-text-text-primary">{threshold}%</dd>
        <dd className="niuu-m-0 niuu-font-mono niuu-text-text-primary">{maxConcurrentRaids}</dd>
        <dd className="niuu-m-0 niuu-font-mono niuu-text-text-primary">
          {autoContinue ? 'on' : 'off'}
        </dd>
        <dd className="niuu-m-0 niuu-font-mono niuu-text-text-primary">3</dd>
      </dl>
    </div>
  );
}

function SegmentedFilter({
  value,
  onChange,
  counts,
}: {
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
  counts: Record<StatusFilter, number>;
}) {
  return (
    <div
      className="niuu-flex niuu-gap-1 niuu-p-1 niuu-rounded-md niuu-bg-bg-tertiary niuu-w-fit"
      role="group"
      aria-label="Filter raids by status"
    >
      {(Object.keys(FILTER_LABELS) as StatusFilter[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={value === key}
          className={cn(
            'niuu-rounded niuu-px-3 niuu-py-1 niuu-text-xs niuu-font-medium niuu-transition-colors',
            value === key
              ? 'niuu-bg-bg-elevated niuu-text-text-primary'
              : 'niuu-text-text-muted niuu-hover:text-text-secondary',
          )}
        >
          {FILTER_LABELS[key]}
          <span className="niuu-ml-1.5 niuu-opacity-60">{counts[key]}</span>
        </button>
      ))}
    </div>
  );
}

function GateChips({ gates }: { gates: FeasibilityGate[] }) {
  const failing = gates.filter((g) => !g.passed);
  if (failing.length === 0) return null;

  return (
    <div className="niuu-flex niuu-flex-wrap niuu-gap-1">
      {failing.map((gate) => (
        <Tooltip key={gate.name} content={gate.reason} side="top">
          <span className="niuu-inline-flex niuu-items-center niuu-gap-1 niuu-rounded-full niuu-border niuu-border-critical-bo niuu-bg-critical-bg niuu-px-2 niuu-py-0.5 niuu-text-xs niuu-text-critical niuu-cursor-default">
            {GATE_LABELS[gate.name]}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

const GATE_LABELS: Record<string, string> = {
  raven_resolution: 'no raven',
  confidence: 'low conf',
  upstream_blocked: 'upstream',
  cluster_healthy: 'cluster',
};

function BatchDispatchBar({
  selectedCount,
  canDispatch,
  onDispatch,
  isDispatching,
}: {
  selectedCount: number;
  canDispatch: boolean;
  onDispatch: () => void;
  isDispatching: boolean;
}) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="niuu-fixed niuu-bottom-6 niuu-left-1/2 niuu--translate-x-1/2 niuu-flex niuu-items-center niuu-gap-3 niuu-rounded-xl niuu-border niuu-border-border niuu-bg-bg-elevated niuu-px-5 niuu-py-3 niuu-shadow-lg"
      role="status"
      aria-live="polite"
    >
      <span className="niuu-text-sm niuu-text-text-secondary">
        {selectedCount} raid{selectedCount !== 1 ? 's' : ''} selected
      </span>
      <Tooltip
        content={canDispatch ? undefined : 'Select only ready raids to dispatch'}
        side="top"
      >
        <button
          type="button"
          onClick={onDispatch}
          disabled={!canDispatch || isDispatching}
          className={cn(
            'niuu-rounded-md niuu-px-4 niuu-py-1.5 niuu-text-sm niuu-font-medium niuu-transition-colors',
            canDispatch && !isDispatching
              ? 'niuu-bg-brand niuu-text-bg-primary hover:niuu-bg-brand-600'
              : 'niuu-cursor-not-allowed niuu-opacity-50 niuu-bg-bg-tertiary niuu-text-text-muted',
          )}
          aria-disabled={!canDispatch || isDispatching}
        >
          {isDispatching ? 'Dispatching…' : 'Dispatch'}
        </button>
      </Tooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function DispatchView() {
  const dispatcherQuery = useDispatcherState();
  const queueQuery = useDispatchQueue();
  const dispatchBus = useService<IDispatchBus>('tyr.dispatch');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [optimisticQueued, setOptimisticQueued] = useState<Set<string>>(new Set());
  const [isDispatching, setIsDispatching] = useState(false);

  const dispatcherState = dispatcherQuery.data ?? null;

  // Enrich each entry with feasibility + optimistic status
  const enriched: EnrichedEntry[] = useMemo(() => {
    const entries = queueQuery.data ?? [];
    if (!dispatcherState) return [];

    return entries.map((entry) => {
      const effectiveStatus: RaidStatus = optimisticQueued.has(entry.raid.id)
        ? 'queued'
        : entry.raid.status;

      const feasibility = checkFeasibility({
        raid: { ...entry.raid, status: effectiveStatus },
        phase: entry.phase,
        allPhasesForSaga: entry.allPhases,
        dispatcherState,
        ravenResolved: true,
        clusterHealthy: true,
      });

      return { ...entry, feasibility, effectiveStatus };
    });
  }, [queueQuery.data, dispatcherState, optimisticQueued]);

  // Apply filter
  const filtered = useMemo(() => {
    let result = enriched;

    switch (statusFilter) {
      case 'ready':
        result = result.filter(
          (e) => e.feasibility.feasible && !QUEUE_STATUSES.includes(e.effectiveStatus),
        );
        break;
      case 'blocked':
        result = result.filter(
          (e) => !e.feasibility.feasible && !QUEUE_STATUSES.includes(e.effectiveStatus),
        );
        break;
      case 'queue':
        result = result.filter((e) => QUEUE_STATUSES.includes(e.effectiveStatus));
        break;
      default:
        result = result.filter((e) => !TERMINAL_STATUSES.includes(e.effectiveStatus));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.raid.name.toLowerCase().includes(q) ||
          e.saga.name.toLowerCase().includes(q) ||
          e.phase.name.toLowerCase().includes(q),
      );
    }

    return result;
  }, [enriched, statusFilter, searchQuery]);

  // Counts per tab
  const counts = useMemo((): Record<StatusFilter, number> => {
    const ready = enriched.filter(
      (e) => e.feasibility.feasible && !QUEUE_STATUSES.includes(e.effectiveStatus),
    ).length;
    const blocked = enriched.filter(
      (e) => !e.feasibility.feasible && !QUEUE_STATUSES.includes(e.effectiveStatus),
    ).length;
    const queue = enriched.filter((e) => QUEUE_STATUSES.includes(e.effectiveStatus)).length;
    return { all: ready + blocked + queue, ready, blocked, queue };
  }, [enriched]);

  // Determine if all selected raids are feasible
  const selectedEntries = filtered.filter((e) => selectedIds.has(e.raid.id));
  const allSelectedFeasible =
    selectedEntries.length > 0 && selectedEntries.every((e) => e.feasibility.feasible);

  async function handleDispatch() {
    const ids = Array.from(selectedIds) as string[];
    setIsDispatching(true);
    setOptimisticQueued((prev) => new Set([...prev, ...ids]));
    setSelectedIds(new Set());

    try {
      await dispatchBus.dispatchBatch(ids);
    } catch {
      // Roll back optimistic update on failure
      setOptimisticQueued((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } finally {
      setIsDispatching(false);
    }
  }

  // Table row shape — needs an `id` field
  type Row = EnrichedEntry & { id: string };
  const rows: Row[] = filtered.map((e) => ({ ...e, id: e.raid.id }));

  const columns: TableColumn<Row>[] = [
    {
      key: 'raid',
      header: 'Raid',
      render: (row) => (
        <div>
          <div className="niuu-text-sm niuu-text-text-primary">{row.raid.name}</div>
          <div className="niuu-text-xs niuu-text-text-muted niuu-mt-0.5">
            {row.saga.name} · {row.phase.name}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (row) => (
        <StatusBadge
          status={row.effectiveStatus as Parameters<typeof StatusBadge>[0]['status']}
          pulse={row.effectiveStatus === 'running'}
        />
      ),
    },
    {
      key: 'confidence',
      header: 'Confidence',
      width: '130px',
      render: (row) => {
        const level =
          row.raid.confidence >= 80
            ? 'high'
            : row.raid.confidence >= 50
              ? 'medium'
              : 'low';
        return (
          <div className="niuu-flex niuu-items-center niuu-gap-2">
            <ConfidenceBar level={level} />
            <span className="niuu-text-xs niuu-font-mono niuu-text-text-secondary">
              {row.raid.confidence}%
            </span>
          </div>
        );
      },
    },
    {
      key: 'gates',
      header: 'Feasibility',
      render: (row) =>
        row.feasibility.feasible ? (
          <span className="niuu-text-xs niuu-text-text-muted">ready</span>
        ) : (
          <GateChips gates={row.feasibility.gates} />
        ),
    },
  ];

  const isLoading = dispatcherQuery.isLoading || queueQuery.isLoading;
  const isError = dispatcherQuery.isError || queueQuery.isError;

  if (isLoading) {
    return (
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-p-6" role="status">
        <StateDot state="processing" pulse />
        <span className="niuu-text-sm niuu-text-text-secondary">loading dispatch queue…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-p-6" role="alert">
        <StateDot state="failed" />
        <span className="niuu-text-sm niuu-text-text-secondary">failed to load dispatch queue</span>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="niuu-p-6">
        {/* Rule summary card */}
        {dispatcherState && (
          <RuleCard
            threshold={dispatcherState.threshold}
            maxConcurrentRaids={dispatcherState.maxConcurrentRaids}
            autoContinue={dispatcherState.autoContinue}
          />
        )}

        {/* Controls */}
        <div className="niuu-flex niuu-items-center niuu-justify-between niuu-mb-4 niuu-gap-4 niuu-flex-wrap">
          <SegmentedFilter
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setSelectedIds(new Set());
            }}
            counts={counts}
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search raids…"
            aria-label="Search raids"
            className="niuu-rounded-md niuu-border niuu-border-border niuu-bg-bg-tertiary niuu-px-3 niuu-py-1.5 niuu-text-sm niuu-text-text-primary niuu-outline-none focus:niuu-border-brand"
          />
        </div>

        {/* Table */}
        <Table
          columns={columns}
          rows={rows}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          aria-label="Dispatch queue"
        />

        {filtered.length === 0 && (
          <div className="niuu-py-12 niuu-text-center niuu-text-sm niuu-text-text-muted">
            No raids match the current filter.
          </div>
        )}

        {/* Batch dispatch bar */}
        <BatchDispatchBar
          selectedCount={selectedIds.size}
          canDispatch={allSelectedFeasible}
          onDispatch={handleDispatch}
          isDispatching={isDispatching}
        />
      </div>
    </TooltipProvider>
  );
}
