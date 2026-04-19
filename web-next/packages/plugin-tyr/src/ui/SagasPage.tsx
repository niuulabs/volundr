import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  StatusBadge,
  ConfidenceBadge,
  LoadingState,
  ErrorState,
  EmptyState,
  Pipe,
  Rune,
} from '@niuulabs/ui';
import type { SagaStatus } from '../domain/saga';
import type { PipeCellStatus } from '@niuulabs/ui';
import { useSagas } from './useSagas';

type StatusFilter = SagaStatus | 'all';

function phaseStatusToCell(status: 'pending' | 'active' | 'gated' | 'complete'): PipeCellStatus {
  switch (status) {
    case 'complete':
      return 'ok';
    case 'active':
      return 'run';
    case 'gated':
      return 'gate';
    case 'pending':
      return 'pend';
  }
}

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Complete', value: 'complete' },
  { label: 'Failed', value: 'failed' },
];

export function SagasPage() {
  const navigate = useNavigate();
  const { data: sagas, isLoading, isError, error } = useSagas();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

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

  return (
    <div className="niuu-p-6 niuu-space-y-6">
      <header className="niuu-flex niuu-items-center niuu-gap-3">
        <Rune glyph="ᛏ" size={28} />
        <h2 className="niuu-m-0 niuu-text-xl niuu-font-semibold niuu-text-text-primary">
          Tyr · Sagas
        </h2>
      </header>

      {/* Search + status subnav */}
      <div className="niuu-flex niuu-items-center niuu-gap-4 niuu-flex-wrap">
        <input
          type="search"
          placeholder="Search sagas…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search sagas"
          className="niuu-px-3 niuu-py-1.5 niuu-rounded-md niuu-bg-bg-secondary niuu-border niuu-border-border niuu-text-sm niuu-text-text-primary niuu-placeholder-text-muted niuu-outline-none"
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
                'niuu-px-3 niuu-py-1 niuu-rounded niuu-text-sm niuu-transition-colors',
                filter === tab.value
                  ? 'niuu-bg-brand niuu-text-bg-primary niuu-font-medium'
                  : 'niuu-text-text-secondary hover:niuu-text-text-primary',
              ].join(' ')}
            >
              {tab.label}
              {tab.value !== 'all' && (
                <span className="niuu-ml-1 niuu-text-xs niuu-opacity-70">
                  ({counts[tab.value as SagaStatus]})
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Saga list */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No sagas found"
          description={
            search
              ? `No sagas match "${search}"`
              : `No ${filter === 'all' ? '' : filter + ' '}sagas yet.`
          }
        />
      ) : (
        <ul className="niuu-list-none niuu-p-0 niuu-m-0 niuu-space-y-3">
          {filtered.map((saga) => (
            <li key={saga.id}>
              <button
                type="button"
                className="niuu-w-full niuu-text-left niuu-p-4 niuu-rounded-lg niuu-bg-bg-secondary niuu-border niuu-border-border niuu-cursor-pointer"
                onClick={() =>
                  void navigate({
                    to: '/tyr/sagas/$sagaId',
                    params: { sagaId: saga.id },
                  })
                }
                aria-label={`View saga ${saga.name}`}
              >
                <div className="niuu-flex niuu-items-start niuu-justify-between niuu-gap-4">
                  <div className="niuu-flex niuu-flex-col niuu-gap-2 niuu-min-w-0">
                    <div className="niuu-flex niuu-items-center niuu-gap-2">
                      <StatusBadge status={saga.status} />
                      <span className="niuu-font-semibold niuu-text-text-primary">{saga.name}</span>
                    </div>
                    <p className="niuu-m-0 niuu-text-xs niuu-text-text-muted">
                      {saga.trackerId} · {saga.featureBranch} · Created{' '}
                      {new Date(saga.createdAt).toLocaleDateString()}
                    </p>
                    <Pipe
                      cells={Array.from({ length: saga.phaseSummary.total }, (_, i) => ({
                        status:
                          i < saga.phaseSummary.completed
                            ? phaseStatusToCell('complete')
                            : phaseStatusToCell('pending'),
                        label: `Phase ${i + 1}`,
                      }))}
                    />
                  </div>
                  <div className="niuu-flex-shrink-0">
                    <ConfidenceBadge value={saga.confidence / 100} />
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
