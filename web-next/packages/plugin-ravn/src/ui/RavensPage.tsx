import { useState, useCallback } from 'react';
import { StateDot, BudgetBar, LoadingState, ErrorState } from '@niuulabs/ui';
import type { Ravn } from '../domain/ravn';
import { useRavens } from './hooks/useRavens';
import { useRavnBudgets } from './hooks/useBudget';
import { groupRavens, type GroupKey } from './grouping';
import { RavnDetail } from './RavnDetail';

export type LayoutVariant = 'split' | 'table' | 'cards';

const LAYOUT_STORAGE_KEY = 'ravn.ravens.layout';
const GROUP_STORAGE_KEY = 'ravn.ravens.group';

function loadStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

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
  const dotState =
    ravn.status === 'active'
      ? 'ok'
      : ravn.status === 'suspended'
        ? 'warn'
        : ravn.status === 'failed'
          ? 'err'
          : 'mute';

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="ravn-list-row"
      aria-selected={selected}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-3)',
        background: selected ? 'var(--color-bg-tertiary)' : 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--color-border-subtle)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <StateDot state={dotState} pulse={ravn.status === 'active'} size={8} />
      <span
        style={{
          flex: 1,
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
        }}
      >
        {ravn.personaName}
      </span>
      {budgetCap != null && budgetSpent != null && (
        <div style={{ width: 64, flexShrink: 0 }}>
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
  const dotState =
    ravn.status === 'active'
      ? 'ok'
      : ravn.status === 'suspended'
        ? 'warn'
        : ravn.status === 'failed'
          ? 'err'
          : 'mute';

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="ravn-card"
      aria-selected={selected}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        padding: 'var(--space-4)',
        background: selected ? 'var(--color-bg-tertiary)' : 'var(--color-bg-secondary)',
        border: `1px solid ${selected ? 'var(--color-border)' : 'var(--color-border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <StateDot state={dotState} pulse={ravn.status === 'active'} size={8} />
        <span
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            flex: 1,
          }}
        >
          {ravn.personaName}
        </span>
      </div>
      <span
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {ravn.model}
      </span>
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
  const dotState =
    ravn.status === 'active'
      ? 'ok'
      : ravn.status === 'suspended'
        ? 'warn'
        : ravn.status === 'failed'
          ? 'err'
          : 'mute';

  return (
    <tr
      onClick={onClick}
      data-testid="ravn-table-row"
      aria-selected={selected}
      style={{
        background: selected ? 'var(--color-bg-tertiary)' : 'transparent',
        cursor: 'pointer',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <td
        style={{
          padding: 'var(--space-3)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
        }}
      >
        {ravn.personaName}
      </td>
      <td style={{ padding: 'var(--space-3)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state={dotState} pulse={ravn.status === 'active'} size={8} />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {ravn.status}
          </span>
        </span>
      </td>
      <td
        style={{
          padding: 'var(--space-3)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {ravn.model}
      </td>
      <td style={{ padding: 'var(--space-3)', minWidth: 120 }}>
        {budget ? (
          <BudgetBar
            spent={budget.spentUsd}
            cap={budget.capUsd}
            warnAt={Math.round(budget.warnAt * 100)}
            size="sm"
          />
        ) : (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>—</span>
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
    <div
      style={{
        padding: 'var(--space-2) var(--space-3)',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        background: 'var(--color-bg-primary)',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <span>{label}</span>
      <span
        style={{
          fontSize: 'var(--text-xs)',
          padding: '0 var(--space-2)',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-bg-elevated)',
          color: 'var(--color-text-muted)',
        }}
      >
        {count}
      </span>
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
    <div
      data-testid="ravens-page"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: 'var(--space-3) var(--space-6)',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-primary)',
        }}
      >
        {/* Layout selector */}
        <div
          role="group"
          aria-label="Layout variant"
          data-testid="layout-selector"
          style={{ display: 'flex', gap: 'var(--space-1)' }}
        >
          {(['split', 'table', 'cards'] as LayoutVariant[]).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={layout === v}
              onClick={() => handleLayoutChange(v)}
              data-testid={`layout-btn-${v}`}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
                background: layout === v ? 'var(--color-bg-tertiary)' : 'transparent',
                color: layout === v ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: 'var(--text-xs)',
                fontWeight: layout === v ? 600 : 400,
              }}
            >
              {v}
            </button>
          ))}
        </div>

        <div style={{ width: '1px', height: 16, background: 'var(--color-border)' }} />

        {/* Grouping selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <label
            htmlFor="group-select"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}
          >
            Group by
          </label>
          <select
            id="group-select"
            value={groupBy}
            onChange={(e) => handleGroupChange(e.target.value as GroupKey)}
            data-testid="grouping-selector"
            style={{
              fontSize: 'var(--text-xs)',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            {(['none', 'state', 'persona', 'location'] as GroupKey[]).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>

        <span
          style={{
            marginLeft: 'auto',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          {ravnList.length} ravn{ravnList.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Split layout */}
        {layout === 'split' && (
          <>
            <div
              style={{
                width: 280,
                flexShrink: 0,
                overflowY: 'auto',
                borderRight: '1px solid var(--color-border)',
                background: 'var(--color-bg-primary)',
              }}
              data-testid="layout-split"
            >
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

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {selectedRavn ? (
                <RavnDetail ravn={selectedRavn} onClose={() => setSelectedRavnId(null)} />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: 'var(--color-text-muted)',
                    fontSize: 'var(--text-sm)',
                  }}
                  data-testid="detail-empty"
                >
                  Select a ravn to view details
                </div>
              )}
            </div>
          </>
        )}

        {/* Table layout */}
        {layout === 'table' && (
          <div
            style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4) var(--space-6)' }}
            data-testid="layout-table"
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {TABLE_COLUMNS.map((col) => (
                    <th
                      key={col}
                      style={{
                        padding: 'var(--space-2) var(--space-3)',
                        textAlign: 'left',
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-muted)',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groupEntries.map(([groupLabel, groupRavns]) => (
                  <>
                    {groupBy !== 'none' && (
                      <tr key={`group-${groupLabel}`}>
                        <td
                          colSpan={TABLE_COLUMNS.length}
                          style={{
                            padding: 'var(--space-2) var(--space-3)',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 600,
                            color: 'var(--color-text-muted)',
                            background: 'var(--color-bg-primary)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                          }}
                        >
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
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Cards layout */}
        {layout === 'cards' && (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-6)',
            }}
            data-testid="layout-cards"
          >
            {groupEntries.map(([groupLabel, groupRavns]) => (
              <div key={groupLabel}>
                {groupBy !== 'none' && (
                  <h4
                    style={{
                      margin: '0 0 var(--space-3)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 600,
                      color: 'var(--color-text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {groupLabel} ({groupRavns.length})
                  </h4>
                )}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: 'var(--space-3)',
                  }}
                >
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
