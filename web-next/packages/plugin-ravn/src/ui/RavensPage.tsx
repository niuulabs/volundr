import { useState, useCallback, Fragment } from 'react';
import { StateDot, BudgetBar, LoadingState, ErrorState } from '@niuulabs/ui';
import type { Ravn } from '../domain/ravn';
import { useRavens } from './hooks/useRavens';
import { useRavnBudgets } from './hooks/useBudget';
import { groupRavens, ravnStatusToDotState, type GroupKey } from './grouping';
import { RavnDetail } from './RavnDetail';
import { loadStorage, saveStorage } from './storage';
import './RavensPage.css';

export type LayoutVariant = 'split' | 'table' | 'cards';

const LAYOUT_STORAGE_KEY = 'ravn.ravens.layout';
const GROUP_STORAGE_KEY = 'ravn.ravens.group';

interface RavnRowProps {
  ravn: Ravn;
  budgetSpent?: number;
  budgetCap?: number;
  budgetWarnAt?: number;
  selected?: boolean;
  onClick?: () => void;
}

function RavnListRow({
  ravn,
  budgetSpent,
  budgetCap,
  budgetWarnAt,
  selected,
  onClick,
}: RavnRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="ravn-list-row"
      aria-selected={selected}
      className="rv-list-row"
    >
      <StateDot
        state={ravnStatusToDotState(ravn.status)}
        pulse={ravn.status === 'active'}
        size={8}
      />
      <span className="rv-list-row__name">{ravn.personaName}</span>
      {budgetCap != null && budgetSpent != null && (
        <div className="rv-list-row__budget">
          <BudgetBar
            spent={budgetSpent}
            cap={budgetCap}
            warnAt={budgetWarnAt != null ? Math.round(budgetWarnAt * 100) : 80}
            size="sm"
          />
        </div>
      )}
    </button>
  );
}

interface RavnCardProps {
  ravn: Ravn;
  budget?: { spentUsd: number; capUsd: number; warnAt: number };
  selected?: boolean;
  onClick?: () => void;
}

function RavnCard({ ravn, budget, selected, onClick }: RavnCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="ravn-card"
      aria-selected={selected}
      className="rv-card"
    >
      <div className="rv-card__header">
        <StateDot
          state={ravnStatusToDotState(ravn.status)}
          pulse={ravn.status === 'active'}
          size={8}
        />
        <span className="rv-card__name">{ravn.personaName}</span>
      </div>
      <span className="rv-card__model">{ravn.model}</span>
      {budget && (
        <BudgetBar
          spent={budget.spentUsd}
          cap={budget.capUsd}
          warnAt={Math.round(budget.warnAt * 100)}
          size="sm"
        />
      )}
    </button>
  );
}

const TABLE_COLUMNS = ['Persona', 'Status', 'Model', 'Budget'] as const;

interface RavnTableRowProps {
  ravn: Ravn;
  budget?: { spentUsd: number; capUsd: number; warnAt: number };
  selected?: boolean;
  onClick?: () => void;
}

function RavnTableRow({ ravn, budget, selected, onClick }: RavnTableRowProps) {
  return (
    <tr
      onClick={onClick}
      data-testid="ravn-table-row"
      aria-selected={selected}
      className="rv-table-row"
    >
      <td className="rv-td--persona">{ravn.personaName}</td>
      <td className="rv-td--status">
        <span className="rv-td-status-inner">
          <StateDot
            state={ravnStatusToDotState(ravn.status)}
            pulse={ravn.status === 'active'}
            size={8}
          />
          <span>{ravn.status}</span>
        </span>
      </td>
      <td className="rv-td--model">{ravn.model}</td>
      <td className="rv-td--budget">
        {budget ? (
          <BudgetBar
            spent={budget.spentUsd}
            cap={budget.capUsd}
            warnAt={Math.round(budget.warnAt * 100)}
            size="sm"
          />
        ) : (
          <span className="rv-td--dash">—</span>
        )}
      </td>
    </tr>
  );
}

interface GroupHeaderProps {
  label: string;
  count: number;
}

function GroupHeader({ label, count }: GroupHeaderProps) {
  return (
    <div className="rv-group-header">
      <span>{label}</span>
      <span className="rv-group-header__badge">{count}</span>
    </div>
  );
}

export function RavensPage() {
  const [layout, setLayout] = useState<LayoutVariant>(() =>
    loadStorage<LayoutVariant>(LAYOUT_STORAGE_KEY, 'split'),
  );
  const [groupBy, setGroupBy] = useState<GroupKey>(() =>
    loadStorage<GroupKey>(GROUP_STORAGE_KEY, 'none'),
  );
  const [selectedRavnId, setSelectedRavnId] = useState<string | null>(null);

  const { data: ravens, isLoading, isError, error } = useRavens();
  const ravnList = ravens ?? [];
  const ravnIds = ravnList.map((r) => r.id);
  const budgets = useRavnBudgets(ravnIds);

  const handleLayoutChange = useCallback((v: LayoutVariant) => {
    setLayout(v);
    saveStorage(LAYOUT_STORAGE_KEY, v);
  }, []);

  const handleGroupChange = useCallback((v: GroupKey) => {
    setGroupBy(v);
    saveStorage(GROUP_STORAGE_KEY, v);
  }, []);

  const selectedRavn = ravnList.find((r) => r.id === selectedRavnId) ?? null;

  const groups = groupRavens(ravnList, groupBy);
  const groupEntries = Object.entries(groups);

  if (isLoading) {
    return (
      <div data-testid="ravens-loading">
        <LoadingState label="Loading ravens…" />
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="ravens-error">
        <ErrorState message={error instanceof Error ? error.message : 'Failed to load ravens'} />
      </div>
    );
  }

  return (
    <div data-testid="ravens-page" className="rv-ravens">
      {/* Toolbar */}
      <div className="rv-ravens__toolbar">
        <div
          role="group"
          aria-label="Layout variant"
          data-testid="layout-selector"
          className="rv-layout-group"
        >
          {(['split', 'table', 'cards'] as LayoutVariant[]).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={layout === v}
              onClick={() => handleLayoutChange(v)}
              data-testid={`layout-btn-${v}`}
              className="rv-layout-btn"
            >
              {v}
            </button>
          ))}
        </div>

        <div className="rv-toolbar-divider" />

        <div className="rv-group-by">
          <label htmlFor="group-select" className="rv-group-by__label">
            Group by
          </label>
          <select
            id="group-select"
            value={groupBy}
            onChange={(e) => handleGroupChange(e.target.value as GroupKey)}
            data-testid="grouping-selector"
            className="rv-group-by__select"
          >
            {(['none', 'state', 'persona', 'location'] as GroupKey[]).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <span className="rv-ravens__count">
          {ravnList.length} ravn{ravnList.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Content area */}
      <div className="rv-ravens__content">
        {/* Split layout */}
        {layout === 'split' && (
          <>
            <div className="rv-split__list" data-testid="layout-split">
              {groupEntries.map(([groupLabel, groupRavns]) => (
                <div key={groupLabel}>
                  {groupBy !== 'none' && (
                    <GroupHeader label={groupLabel} count={groupRavns.length} />
                  )}
                  {groupRavns.map((r) => {
                    const b = budgets[r.id];
                    return (
                      <RavnListRow
                        key={r.id}
                        ravn={r}
                        budgetSpent={b?.spentUsd}
                        budgetCap={b?.capUsd}
                        budgetWarnAt={b?.warnAt}
                        selected={r.id === selectedRavnId}
                        onClick={() => setSelectedRavnId(r.id === selectedRavnId ? null : r.id)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="rv-split__detail">
              {selectedRavn ? (
                <RavnDetail ravn={selectedRavn} onClose={() => setSelectedRavnId(null)} />
              ) : (
                <div className="rv-detail-empty" data-testid="detail-empty">
                  Select a ravn to view details
                </div>
              )}
            </div>
          </>
        )}

        {/* Table layout */}
        {layout === 'table' && (
          <div className="rv-table-layout" data-testid="layout-table">
            <table className="rv-table">
              <thead>
                <tr className="rv-thead-row">
                  {TABLE_COLUMNS.map((col) => (
                    <th key={col} className="rv-th">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupEntries.map(([groupLabel, groupRavns]) => (
                  <Fragment key={groupLabel}>
                    {groupBy !== 'none' && (
                      <tr>
                        <td colSpan={TABLE_COLUMNS.length} className="rv-group-td">
                          {groupLabel} ({groupRavns.length})
                        </td>
                      </tr>
                    )}
                    {groupRavns.map((r) => (
                      <RavnTableRow
                        key={r.id}
                        ravn={r}
                        budget={budgets[r.id]}
                        selected={r.id === selectedRavnId}
                        onClick={() => setSelectedRavnId(r.id === selectedRavnId ? null : r.id)}
                      />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Cards layout */}
        {layout === 'cards' && (
          <div className="rv-cards-layout" data-testid="layout-cards">
            {groupEntries.map(([groupLabel, groupRavns]) => (
              <div key={groupLabel}>
                {groupBy !== 'none' && (
                  <h4 className="rv-cards-section__heading">
                    {groupLabel} ({groupRavns.length})
                  </h4>
                )}
                <div className="rv-cards-grid">
                  {groupRavns.map((r) => (
                    <RavnCard
                      key={r.id}
                      ravn={r}
                      budget={budgets[r.id]}
                      selected={r.id === selectedRavnId}
                      onClick={() => setSelectedRavnId(r.id === selectedRavnId ? null : r.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
