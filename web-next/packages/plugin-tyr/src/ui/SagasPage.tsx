import { useState, useEffect } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  StatusBadge,
  ConfidenceBadge,
  LoadingState,
  ErrorState,
  EmptyState,
  Pipe,
  Rune,
  relTime,
} from '@niuulabs/ui';
import type { SagaStatus } from '../domain/saga';
import type { Saga } from '../domain/saga';
import { useSagas } from './useSagas';
import { phaseStatusToCell } from './mappers';
import { SagaDetailPage } from './SagaDetailPage';

// ---------------------------------------------------------------------------
// Deterministic saga glyph (hash saga trackerId → Elder Futhark rune)
// ---------------------------------------------------------------------------

// Safe Elder Futhark runes — forbidden appropriated symbols (Algiz ᛉ, Othala ᛟ,
// Tiwaz ᛏ, Sowilo ᛊ, Hagalaz ᚺ/ᚻ) are explicitly excluded per runeMap.ts.
const SAGA_GLYPHS = ['ᚠ', 'ᚱ', 'ᚲ', 'ᚷ', 'ᚢ', 'ᚨ', 'ᛃ', 'ᚦ', 'ᛒ', 'ᛖ', 'ᛗ', 'ᛜ', 'ᚹ', 'ᛞ'];

function sagaGlyph(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SAGA_GLYPHS[h % SAGA_GLYPHS.length]!;
}

// ---------------------------------------------------------------------------
// Filter types
// ---------------------------------------------------------------------------

type StatusFilter = SagaStatus | 'all';

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Complete', value: 'complete' },
  { label: 'Failed', value: 'failed' },
];

// ---------------------------------------------------------------------------
// SagaListRow
// ---------------------------------------------------------------------------

interface SagaListRowProps {
  saga: Saga;
  isSelected: boolean;
  onClick: () => void;
}

function SagaListRow({ saga, isSelected, onClick }: SagaListRowProps) {
  const totalRaids = saga.phaseSummary.total;
  const mergedRaids = saga.phaseSummary.completed;

  const statusToRaidCellStatus = (s: SagaStatus) => {
    if (s === 'active') return 'run' as const;
    if (s === 'complete') return 'ok' as const;
    return 'crit' as const;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      data-selected={isSelected || undefined}
      className={[
        'niuu-w-full niuu-text-left niuu-p-3 niuu-border-b niuu-border-border-subtle',
        'niuu-cursor-pointer niuu-transition-colors niuu-flex niuu-flex-col niuu-gap-2',
        isSelected
          ? 'niuu-bg-bg-tertiary niuu-border-l-2 niuu-border-l-brand'
          : 'niuu-bg-transparent hover:niuu-bg-bg-secondary',
      ].join(' ')}
      aria-label={`View saga ${saga.name}`}
      aria-pressed={isSelected}
    >
      {/* Glyph + name row */}
      <div className="niuu-flex niuu-items-center niuu-gap-2">
        <span
          className="niuu-font-mono niuu-text-base niuu-text-brand niuu-shrink-0"
          aria-hidden="true"
          title={saga.trackerId}
        >
          {sagaGlyph(saga.trackerId)}
        </span>
        <span className="niuu-font-semibold niuu-text-sm niuu-text-text-primary niuu-truncate">
          {saga.name}
        </span>
      </div>

      {/* Meta row */}
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-flex-wrap">
        <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-bg-bg-elevated niuu-px-1.5 niuu-py-0.5 niuu-rounded">
          {saga.trackerId}
        </span>
        <StatusBadge status={saga.status} />
        <ConfidenceBadge value={saga.confidence / 100} />
        {saga.repos[0] && (
          <span className="niuu-text-xs niuu-text-text-muted niuu-truncate niuu-max-w-[120px]">
            {saga.repos[0]}
          </span>
        )}
        <span className="niuu-text-xs niuu-text-text-faint niuu-font-mono niuu-ml-auto">
          {relTime(saga.createdAt)}
        </span>
      </div>

      {/* Pipe */}
      <Pipe
        cells={Array.from({ length: saga.phaseSummary.total }, (_, i) => ({
          status:
            i < saga.phaseSummary.completed
              ? phaseStatusToCell('complete')
              : statusToRaidCellStatus(saga.status),
          label: `Phase ${i + 1}`,
        }))}
      />

      {/* Counts */}
      <div className="niuu-text-right niuu-font-mono niuu-text-xs niuu-text-text-muted">
        {mergedRaids}/{totalRaids} raids
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// SagasPage
// ---------------------------------------------------------------------------

export function SagasPage() {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { sagaId?: string };
  const { data: sagas, isLoading, isError, error } = useSagas();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedSagaId, setSelectedSagaId] = useState<string | null>(params.sagaId ?? null);

  // Auto-select first active saga when none selected
  useEffect(() => {
    if (!selectedSagaId && sagas && sagas.length > 0) {
      setSelectedSagaId(sagas[0]!.id);
    }
  }, [sagas, selectedSagaId]);

  if (isLoading) return <LoadingState label="Loading sagas…" />;
  if (isError)
    return <ErrorState message={error instanceof Error ? error.message : 'Failed to load sagas'} />;

  const allSagas = sagas ?? [];

  const counts: Record<SagaStatus, number> = {
    active: allSagas.filter((s) => s.status === 'active').length,
    complete: allSagas.filter((s) => s.status === 'complete').length,
    failed: allSagas.filter((s) => s.status === 'failed').length,
  };

  const filtered = allSagas.filter((s) => {
    const matchesStatus = filter === 'all' || s.status === filter;
    const matchesSearch =
      !search ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.trackerId.toLowerCase().includes(search.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  function handleSelectSaga(saga: Saga) {
    setSelectedSagaId(saga.id);
    // Update URL for deep-linking without full navigation
    void navigate({ to: '/tyr/sagas/$sagaId', params: { sagaId: saga.id } });
  }

  return (
    <div className="niuu-flex niuu-h-full niuu-overflow-hidden">
      {/* ── Left list panel ─────────────────────────────── */}
      <div
        className="niuu-flex niuu-flex-col niuu-border-r niuu-border-border-subtle niuu-overflow-hidden"
        style={{ width: 420, flexShrink: 0 }}
        aria-label="Saga list"
      >
        {/* Header */}
        <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-px-4 niuu-py-3 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary">
          <Rune glyph="ᛏ" size={22} />
          <h2 className="niuu-m-0 niuu-text-sm niuu-font-semibold niuu-text-text-primary niuu-flex-1">
            Sagas
          </h2>
          <button
            type="button"
            className="niuu-px-2.5 niuu-py-1 niuu-text-xs niuu-border niuu-border-border-subtle niuu-rounded niuu-text-text-secondary hover:niuu-text-text-primary niuu-bg-transparent niuu-transition-colors"
            onClick={() => {
              const data = JSON.stringify(allSagas, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'sagas.json';
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }}
            aria-label="Export sagas as JSON"
          >
            Export
          </button>
          <button
            type="button"
            className="niuu-px-2.5 niuu-py-1 niuu-text-xs niuu-bg-brand niuu-text-bg-primary niuu-rounded niuu-font-medium"
            onClick={() => void navigate({ to: '/tyr/plan' as never })}
            aria-label="Create new saga"
          >
            + New Saga
          </button>
        </div>

        {/* Search + status filter */}
        <div className="niuu-flex niuu-flex-col niuu-gap-2 niuu-px-3 niuu-py-2 niuu-border-b niuu-border-border-subtle">
          <input
            type="search"
            placeholder="Search sagas…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search sagas"
            className="niuu-px-3 niuu-py-1.5 niuu-rounded-md niuu-bg-bg-secondary niuu-border niuu-border-border niuu-text-xs niuu-text-text-primary niuu-placeholder-text-muted niuu-outline-none niuu-w-full"
          />
          <nav className="niuu-flex niuu-gap-1" role="tablist" aria-label="Filter sagas by status">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={filter === tab.value}
                onClick={() => setFilter(tab.value)}
                className={[
                  'niuu-px-2.5 niuu-py-1 niuu-rounded niuu-text-xs niuu-transition-colors',
                  filter === tab.value
                    ? 'niuu-bg-brand niuu-text-bg-primary niuu-font-medium'
                    : 'niuu-text-text-secondary hover:niuu-text-text-primary',
                ].join(' ')}
              >
                {tab.label}
                {tab.value !== 'all' && (
                  <span className="niuu-ml-1 niuu-opacity-60">
                    ({counts[tab.value as SagaStatus]})
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Saga list */}
        <div className="niuu-flex-1 niuu-overflow-y-auto" role="list" aria-label="Sagas">
          {filtered.length === 0 ? (
            <div className="niuu-p-4">
              <EmptyState
                title="No sagas found"
                description={
                  search
                    ? `No sagas match "${search}"`
                    : `No ${filter === 'all' ? '' : filter + ' '}sagas yet.`
                }
              />
            </div>
          ) : (
            filtered.map((saga) => (
              <div key={saga.id} role="listitem">
                <SagaListRow
                  saga={saga}
                  isSelected={selectedSagaId === saga.id}
                  onClick={() => handleSelectSaga(saga)}
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right detail panel ─────────────────────────── */}
      <div className="niuu-flex-1 niuu-overflow-y-auto" aria-label="Saga detail">
        {selectedSagaId ? (
          <SagaDetailPage sagaId={selectedSagaId} hideBackButton />
        ) : (
          <div className="niuu-flex niuu-items-center niuu-justify-center niuu-h-full">
            <EmptyState
              title="Select a saga"
              description="Click a saga on the left to view its details."
            />
          </div>
        )}
      </div>
    </div>
  );
}
