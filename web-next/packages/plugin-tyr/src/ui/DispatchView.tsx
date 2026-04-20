import { useMemo, useState } from 'react';
import { useService } from '@niuulabs/plugin-sdk';
import {
  StateDot,
  StatusBadge,
  ConfidenceBar,
  Tooltip,
  TooltipProvider,
  SegmentedFilter,
  cn,
} from '@niuulabs/ui';
import type { SegmentedFilterOption } from '@niuulabs/ui';
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
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RETRIES = 3;

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
// Gate chips
// ---------------------------------------------------------------------------

const GATE_LABELS: Record<string, string> = {
  raven_resolution: 'no raven',
  confidence: 'low conf',
  upstream_blocked: 'upstream',
  cluster_healthy: 'cluster',
};

function GateChips({ gates }: { gates: FeasibilityGate[] }) {
  const failing = gates.filter((g) => !g.passed);
  if (failing.length === 0) return null;
  return (
    <div className="niuu-flex niuu-flex-wrap niuu-gap-1">
      {failing.map((gate) => (
        <Tooltip key={gate.name} content={gate.reason} side="top">
          <span className="niuu-inline-flex niuu-items-center niuu-gap-1 niuu-rounded-full niuu-border niuu-border-critical-bo niuu-bg-critical-bg niuu-px-2 niuu-py-0.5 niuu-text-xs niuu-text-critical niuu-cursor-default">
            {GATE_LABELS[gate.name] ?? gate.name}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter options builder
// ---------------------------------------------------------------------------

function buildFilterOptions(counts: Record<StatusFilter, number>): SegmentedFilterOption<StatusFilter>[] {
  return (Object.keys(FILTER_LABELS) as StatusFilter[]).map((key) => ({
    value: key,
    label: FILTER_LABELS[key],
    count: counts[key],
  }));
}

// ---------------------------------------------------------------------------
// Batch dispatch bar
// ---------------------------------------------------------------------------

function BatchDispatchBar({
  selectedCount,
  canDispatch,
  onDispatch,
  isDispatching,
  onApplyWorkflow,
  onOverrideThreshold,
}: {
  selectedCount: number;
  canDispatch: boolean;
  onDispatch: () => void;
  isDispatching: boolean;
  onApplyWorkflow?: () => void;
  onOverrideThreshold?: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <div
      className="niuu-fixed niuu-bottom-6 niuu-left-1/2 niuu--translate-x-1/2 niuu-flex niuu-items-center niuu-gap-3 niuu-rounded-xl niuu-border niuu-border-border niuu-bg-bg-elevated niuu-px-5 niuu-py-3 niuu-shadow-lg"
      role="status"
      aria-live="polite"
    >
      <span className="niuu-text-sm niuu-font-medium niuu-text-text-primary">
        {selectedCount} raid{selectedCount !== 1 ? 's' : ''} selected
      </span>
      {onApplyWorkflow && (
        <button
          type="button"
          onClick={onApplyWorkflow}
          className="niuu-px-3 niuu-py-1.5 niuu-text-xs niuu-border niuu-border-border niuu-rounded-md niuu-text-text-secondary hover:niuu-text-text-primary niuu-bg-transparent niuu-transition-colors"
        >
          Apply workflow
        </button>
      )}
      {onOverrideThreshold && (
        <button
          type="button"
          onClick={onOverrideThreshold}
          className="niuu-px-3 niuu-py-1.5 niuu-text-xs niuu-border niuu-border-border niuu-rounded-md niuu-text-text-secondary hover:niuu-text-text-primary niuu-bg-transparent niuu-transition-colors"
        >
          Override threshold
        </button>
      )}
      <Tooltip content={canDispatch ? undefined : 'Select only ready raids to dispatch'} side="top">
        <button
          type="button"
          onClick={() => {
            if (!canDispatch || isDispatching) return;
            onDispatch();
          }}
          className={cn(
            'niuu-rounded-md niuu-px-4 niuu-py-1.5 niuu-text-sm niuu-font-medium niuu-transition-colors',
            canDispatch && !isDispatching
              ? 'niuu-bg-brand niuu-text-bg-primary hover:niuu-bg-brand-600'
              : 'niuu-cursor-not-allowed niuu-opacity-50 niuu-bg-bg-tertiary niuu-text-text-muted',
          )}
          aria-disabled={!canDispatch || isDispatching}
        >
          {isDispatching ? 'Dispatching…' : 'Dispatch now'}
        </button>
      </Tooltip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saga group header
// ---------------------------------------------------------------------------

function SagaGroupHeader({
  sagaName,
  trackerId,
  featureBranch,
}: {
  sagaName: string;
  trackerId: string;
  featureBranch: string;
}) {
  return (
    <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-px-4 niuu-py-2 niuu-bg-bg-tertiary niuu-border-b niuu-border-border-subtle niuu-sticky niuu-top-0 niuu-z-10">
      <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-bg-bg-elevated niuu-px-1.5 niuu-py-0.5 niuu-rounded">
        {trackerId}
      </span>
      <span className="niuu-text-sm niuu-font-medium niuu-text-text-primary">{sagaName}</span>
      <span className="niuu-text-xs niuu-font-mono niuu-text-text-faint niuu-ml-auto">
        {featureBranch}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Raid row (within saga group)
// ---------------------------------------------------------------------------

function RaidRow({
  entry,
  isSelected,
  onToggle,
}: {
  entry: EnrichedEntry;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        'niuu-flex niuu-items-center niuu-gap-3 niuu-px-4 niuu-py-2.5 niuu-border-b niuu-border-border-subtle',
        isSelected ? 'niuu-bg-bg-secondary' : 'hover:niuu-bg-bg-secondary',
      )}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        className="niuu-rounded niuu-border-border"
        aria-label="Select row"
      />
      <div className="niuu-flex-1 niuu-min-w-0">
        <div className="niuu-text-sm niuu-text-text-primary niuu-truncate">{entry.raid.name}</div>
        <div className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-mt-0.5">
          {entry.raid.trackerId}
          {entry.raid.estimateHours != null && ` · ~${entry.raid.estimateHours}h`}
        </div>
      </div>
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-shrink-0">
        <StatusBadge
          status={entry.effectiveStatus as Parameters<typeof StatusBadge>[0]['status']}
          pulse={entry.effectiveStatus === 'running'}
        />
        {entry.feasibility.feasible ? (
          <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-bg-bg-elevated niuu-px-1.5 niuu-py-0.5 niuu-rounded">
            ready
          </span>
        ) : (
          <GateChips gates={entry.feasibility.gates} />
        )}
        <div className="niuu-flex niuu-items-center niuu-gap-1.5 niuu-w-[80px]">
          <ConfidenceBar
            level={
              entry.raid.confidence >= 80 ? 'high' : entry.raid.confidence >= 50 ? 'medium' : 'low'
            }
          />
          <span className="niuu-text-xs niuu-font-mono niuu-text-text-secondary">
            {entry.raid.confidence}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right panel: dispatch rules + recent dispatches
// ---------------------------------------------------------------------------

function DispatchRulesPanel({
  threshold,
  maxConcurrentRaids,
  autoContinue,
}: {
  threshold: number;
  maxConcurrentRaids: number;
  autoContinue: boolean;
}) {
  const rules = [
    { label: 'Confidence threshold', value: `${threshold}%` },
    { label: 'Concurrent cap', value: String(maxConcurrentRaids) },
    { label: 'Auto-continue', value: autoContinue ? 'on' : 'off' },
    { label: 'Retries', value: String(DEFAULT_MAX_RETRIES) },
    { label: 'Quiet hours', value: 'none' },
    { label: 'Escalation', value: 'notify' },
  ];

  return (
    <div className="niuu-p-4 niuu-flex niuu-flex-col niuu-gap-4">
      {/* Dispatch rules card */}
      <div
        className="niuu-rounded-lg niuu-border niuu-border-border niuu-bg-bg-secondary niuu-p-4"
        aria-label="Dispatch rules"
      >
        <h3 className="niuu-m-0 niuu-mb-3 niuu-text-sm niuu-font-semibold niuu-text-text-primary">
          Dispatch rules
        </h3>
        <dl className="niuu-grid niuu-grid-cols-2 niuu-gap-x-4 niuu-gap-y-2 niuu-text-xs niuu-m-0">
          {rules.map((r) => (
            <div key={r.label}>
              <dt className="niuu-text-text-muted niuu-mb-0.5">{r.label}</dt>
              <dd className="niuu-m-0 niuu-font-mono niuu-text-text-primary">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Recent dispatches card */}
      <div className="niuu-rounded-lg niuu-border niuu-border-border niuu-bg-bg-secondary niuu-p-4">
        <h3 className="niuu-m-0 niuu-mb-3 niuu-text-sm niuu-font-semibold niuu-text-text-primary">
          Recent dispatches
        </h3>
        <p className="niuu-m-0 niuu-text-xs niuu-text-text-muted">No recent dispatches.</p>
      </div>
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  // Group filtered entries by sagaId
  const groupedBySaga = useMemo(() => {
    const map = new Map<
      string,
      { sagaName: string; trackerId: string; featureBranch: string; entries: EnrichedEntry[] }
    >();
    for (const entry of filtered) {
      const existing = map.get(entry.saga.id);
      if (existing) {
        existing.entries.push(entry);
      } else {
        map.set(entry.saga.id, {
          sagaName: entry.saga.name,
          trackerId: entry.saga.trackerId,
          featureBranch: entry.saga.featureBranch,
          entries: [entry],
        });
      }
    }
    return Array.from(map.entries());
  }, [filtered]);

  const selectedEntries = filtered.filter((e) => selectedIds.has(e.raid.id));
  const allSelectedFeasible =
    selectedEntries.length > 0 && selectedEntries.every((e) => e.feasibility.feasible);

  async function handleDispatch() {
    const ids = Array.from(selectedIds);
    setIsDispatching(true);
    setOptimisticQueued((prev) => new Set([...prev, ...ids]));
    setSelectedIds(new Set());

    try {
      await dispatchBus.dispatchBatch(ids);
    } catch {
      setOptimisticQueued((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } finally {
      setIsDispatching(false);
    }
  }

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
      <div className="niuu-flex niuu-h-full niuu-overflow-hidden">
        {/* ── Left: queue ─────────────────────────────── */}
        <div className="niuu-flex niuu-flex-col niuu-flex-1 niuu-overflow-hidden">
          {/* Header */}
          <div className="niuu-px-4 niuu-py-3 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary">
            <div className="niuu-text-xs niuu-uppercase niuu-tracking-wide niuu-text-text-muted niuu-mb-1">
              Dispatch queue
            </div>
            <div className="niuu-flex niuu-items-baseline niuu-justify-between">
              <h2 className="niuu-m-0 niuu-text-lg niuu-font-semibold niuu-text-text-primary">
                {counts.all} raids · {counts.ready} ready
              </h2>
              <div className="niuu-flex niuu-gap-2">
                {dispatcherState && (
                  <>
                    <span className="niuu-text-xs niuu-font-mono niuu-bg-bg-elevated niuu-px-2 niuu-py-1 niuu-rounded niuu-text-text-secondary">
                      threshold{' '}
                      <strong className="niuu-text-brand">{dispatcherState.threshold}%</strong>
                    </span>
                    <span className="niuu-text-xs niuu-font-mono niuu-bg-bg-elevated niuu-px-2 niuu-py-1 niuu-rounded niuu-text-text-secondary">
                      concurrent <strong>{dispatcherState.maxConcurrentRaids}</strong>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-px-4 niuu-py-2 niuu-border-b niuu-border-border-subtle niuu-flex-wrap">
            <SegmentedFilter
              options={buildFilterOptions(counts)}
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setSelectedIds(new Set());
              }}
              aria-label="Filter raids by status"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search raids…"
              aria-label="Search raids"
              className="niuu-rounded-md niuu-border niuu-border-border niuu-bg-bg-tertiary niuu-px-3 niuu-py-1.5 niuu-text-xs niuu-text-text-primary niuu-outline-none focus:niuu-border-brand niuu-ml-auto"
            />
          </div>

          {/* Grouped queue */}
          <div className="niuu-flex-1 niuu-overflow-y-auto" role="list" aria-label="Dispatch queue">
            {groupedBySaga.length === 0 ? (
              <div className="niuu-py-12 niuu-text-center niuu-text-sm niuu-text-text-muted">
                No raids match the current filter.
              </div>
            ) : (
              groupedBySaga.map(([sagaId, group]) => (
                <div key={sagaId} role="listitem">
                  <SagaGroupHeader
                    sagaName={group.sagaName}
                    trackerId={group.trackerId}
                    featureBranch={group.featureBranch}
                  />
                  {group.entries.map((entry) => (
                    <RaidRow
                      key={entry.raid.id}
                      entry={entry}
                      isSelected={selectedIds.has(entry.raid.id)}
                      onToggle={() => toggleId(entry.raid.id)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right: rules panel ──────────────────────── */}
        <div
          className="niuu-border-l niuu-border-border-subtle niuu-overflow-y-auto niuu-bg-bg-primary"
          style={{ width: 280, flexShrink: 0 }}
          aria-label="Dispatch rules panel"
        >
          {dispatcherState ? (
            <DispatchRulesPanel
              threshold={dispatcherState.threshold}
              maxConcurrentRaids={dispatcherState.maxConcurrentRaids}
              autoContinue={dispatcherState.autoContinue}
            />
          ) : null}
        </div>
      </div>

      {/* Batch dispatch bar */}
      <BatchDispatchBar
        selectedCount={selectedIds.size}
        canDispatch={allSelectedFeasible}
        onDispatch={handleDispatch}
        isDispatching={isDispatching}
      />
    </TooltipProvider>
  );
}
