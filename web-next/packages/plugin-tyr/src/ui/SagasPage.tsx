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
  ToastProvider,
  useToast,
  Modal,
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
        'niuu-w-full niuu-text-left niuu-p-3 niuu-border niuu-rounded-md',
        'niuu-cursor-pointer niuu-transition-colors niuu-grid niuu-gap-3 niuu-items-center',
        'niuu-[grid-template-columns:auto_1fr_minmax(120px,0.9fr)_auto_auto]',
        isSelected
          ? 'niuu-bg-[#191f26] niuu-border-brand'
          : 'niuu-bg-[#131820] niuu-border-border-subtle hover:niuu-bg-[#181d25]',
      ].join(' ')}
      aria-label={`View saga ${saga.name}`}
      aria-pressed={isSelected}
    >
      <div
        className="niuu-font-mono niuu-text-base niuu-text-brand niuu-shrink-0 niuu-inline-flex niuu-items-center niuu-justify-center niuu-w-8 niuu-h-8 niuu-rounded-md niuu-bg-bg-secondary niuu-border niuu-border-border-subtle"
        aria-hidden="true"
        title={saga.trackerId}
      >
          {sagaGlyph(saga.trackerId)}
      </div>

      <div className="niuu-flex niuu-flex-col niuu-gap-1 niuu-min-w-0">
        <span className="niuu-font-semibold niuu-text-sm niuu-text-text-primary niuu-truncate">
          {saga.name}
        </span>
        <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-flex-wrap niuu-text-[10px] niuu-font-mono niuu-text-text-muted">
          <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted niuu-bg-bg-elevated niuu-px-1.5 niuu-py-0.5 niuu-rounded">
            {saga.trackerId}
          </span>
          {saga.repos[0] && (
            <span className="niuu-text-text-muted niuu-truncate niuu-max-w-[150px]">{saga.repos[0]}</span>
          )}
          <span>branch · {saga.featureBranch}</span>
          <span>{relTime(saga.createdAt)}</span>
        </div>
      </div>

      <Pipe
        cells={Array.from({ length: saga.phaseSummary.total }, (_, i) => ({
          status:
            i < saga.phaseSummary.completed
              ? phaseStatusToCell('complete')
              : statusToRaidCellStatus(saga.status),
          label: `Phase ${i + 1}`,
        }))}
      />

      <StatusBadge status={saga.status} />
      <div className="niuu-flex niuu-items-center niuu-gap-3 niuu-justify-end">
        <ConfidenceBadge value={saga.confidence / 100} />
        <div className="niuu-flex niuu-flex-col niuu-items-end niuu-font-mono niuu-text-[10px] niuu-text-text-muted">
          <span className="niuu-text-sm niuu-text-text-primary">
            {mergedRaids}/{totalRaids}
          </span>
          <span>raids</span>
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// SagasPage
// ---------------------------------------------------------------------------

export function SagasPage() {
  return (
    <ToastProvider>
      <SagasPageContent />
    </ToastProvider>
  );
}

function SagasPageContent() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const params = useParams({ strict: false }) as { sagaId?: string };
  const { data: sagas, isLoading, isError, error } = useSagas();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [showNewSagaModal, setShowNewSagaModal] = useState(false);
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
    <div className="niuu-flex niuu-flex-col niuu-h-full niuu-overflow-hidden niuu-p-6 niuu-gap-4">
      <div className="niuu-flex niuu-items-start niuu-justify-between niuu-gap-4">
        <div className="niuu-flex niuu-items-start niuu-gap-3">
          <Rune glyph="ᚦ" size={24} />
          <div>
            <h2 className="niuu-m-0 niuu-text-lg niuu-font-semibold niuu-text-text-primary">Sagas</h2>
            <p className="niuu-m-0 niuu-mt-1 niuu-text-sm niuu-text-text-secondary niuu-max-w-[720px]">
              Every saga is a decomposed tracker issue driven by a workflow. Select one to inspect phases, raids and confidence movement.
            </p>
          </div>
        </div>
        <div className="niuu-flex niuu-items-center niuu-gap-2">
          <button
            type="button"
            className="niuu-px-2.5 niuu-py-1.5 niuu-text-xs niuu-border niuu-border-border-subtle niuu-rounded niuu-text-text-secondary hover:niuu-text-text-primary niuu-bg-transparent niuu-transition-colors"
            onClick={() => {
              const data = JSON.stringify(allSagas, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'sagas.json';
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
              toast({ title: `Exported ${allSagas.length} sagas`, tone: 'success' });
            }}
            aria-label="Export sagas as JSON"
          >
            Export
          </button>
          <button
            type="button"
            className="niuu-px-2.5 niuu-py-1.5 niuu-text-xs niuu-bg-brand niuu-text-bg-primary niuu-rounded niuu-font-medium"
            onClick={() => setShowNewSagaModal(true)}
            aria-label="Create new saga"
          >
            + New Saga
          </button>
        </div>
      </div>

      <div className="niuu-flex niuu-h-full niuu-overflow-hidden niuu-gap-4">
        <div
          className="niuu-flex niuu-flex-col niuu-rounded-xl niuu-border niuu-border-border-subtle niuu-bg-bg-secondary niuu-overflow-hidden"
          style={{ width: 460, flexShrink: 0 }}
          aria-label="Saga list"
        >
        <div className="niuu-flex niuu-flex-col niuu-gap-2 niuu-px-3 niuu-py-3 niuu-border-b niuu-border-border-subtle">
          <input
            type="search"
            placeholder="Search sagas…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search sagas"
            className="niuu-px-3 niuu-py-1.5 niuu-rounded-md niuu-bg-bg-secondary niuu-border niuu-border-border niuu-text-xs niuu-text-text-primary niuu-placeholder-text-muted niuu-outline-none niuu-w-full"
          />
          <nav className="niuu-flex niuu-gap-1 niuu-flex-wrap" role="tablist" aria-label="Filter sagas by status">
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
                    ? 'niuu-bg-brand/15 niuu-text-brand niuu-border niuu-border-brand/40 niuu-font-medium'
                    : 'niuu-text-text-secondary hover:niuu-text-text-primary niuu-border niuu-border-transparent',
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

        <div className="niuu-flex-1 niuu-overflow-y-auto niuu-p-3 niuu-flex niuu-flex-col niuu-gap-2" role="list" aria-label="Sagas">
          {filtered.length === 0 ? (
            <div className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-primary niuu-p-4">
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

      <div className="niuu-flex-1 niuu-overflow-y-auto niuu-rounded-xl niuu-border niuu-border-border-subtle niuu-bg-bg-secondary" aria-label="Saga detail">
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

      <Modal
        open={showNewSagaModal}
        onOpenChange={setShowNewSagaModal}
        title="New Saga"
        description="New sagas start from a prompt in the Plan view."
        actions={[
          {
            label: 'Cancel',
            variant: 'secondary',
            closes: true,
          },
          {
            label: 'Go to Plan →',
            variant: 'primary',
            closes: true,
            onClick: () => void navigate({ to: '/tyr/plan' as never }),
          },
        ]}
      >
        <p className="niuu-m-0 niuu-text-sm niuu-text-text-secondary">Want to go there now?</p>
      </Modal>
    </div>
  );
}
