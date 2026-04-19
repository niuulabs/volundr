import { Fragment, type ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './Table.css';

export interface ColumnDef<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface TableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  sortState?: SortState;
  onSortChange?: (sort: SortState) => void;
  selectable?: boolean;
  selectedKeys?: ReadonlySet<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  expandedKeys?: ReadonlySet<string>;
  onExpandChange?: (keys: Set<string>) => void;
  renderExpanded?: (row: T) => ReactNode;
  stickyHeader?: boolean;
  emptyState?: ReactNode;
  'aria-label'?: string;
  className?: string;
}

function SortIcon({ direction }: { direction: SortDirection | undefined }) {
  if (!direction) {
    return (
      <span className="niuu-table__sort-icon niuu-table__sort-icon--none" aria-hidden>
        ⇅
      </span>
    );
  }
  return (
    <span className="niuu-table__sort-icon" aria-hidden>
      {direction === 'asc' ? '↑' : '↓'}
    </span>
  );
}

export function Table<T>({
  columns,
  rows,
  getRowKey,
  sortState,
  onSortChange,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  expandedKeys,
  onExpandChange,
  renderExpanded,
  stickyHeader = false,
  emptyState,
  'aria-label': ariaLabel,
  className,
}: TableProps<T>) {
  const allKeys = rows.map(getRowKey);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedKeys?.has(k));
  const someSelected = !allSelected && allKeys.some((k) => selectedKeys?.has(k));

  function handleHeaderSort(col: ColumnDef<T>) {
    if (!col.sortable || !onSortChange) return;
    const nextDirection: SortDirection =
      sortState?.key === col.key && sortState.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key: col.key, direction: nextDirection });
  }

  function handleSelectAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
      return;
    }
    onSelectionChange(new Set(allKeys));
  }

  function handleSelectRow(key: string) {
    if (!onSelectionChange || !selectedKeys) return;
    const next = new Set(selectedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onSelectionChange(next);
  }

  function handleExpandRow(key: string) {
    if (!onExpandChange || !expandedKeys) return;
    const next = new Set(expandedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    onExpandChange(next);
  }

  const hasExpand = !!renderExpanded;

  return (
    <div className={cn('niuu-table-wrap', className)} role="region" aria-label={ariaLabel}>
      <table className={cn('niuu-table', stickyHeader && 'niuu-table--sticky-header')}>
        <thead className="niuu-table__head">
          <tr>
            {selectable && (
              <th className="niuu-table__th niuu-table__th--check" scope="col">
                <input
                  type="checkbox"
                  className="niuu-table__checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={handleSelectAll}
                  aria-label="Select all rows"
                />
              </th>
            )}
            {hasExpand && <th className="niuu-table__th niuu-table__th--expand" scope="col" />}
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'niuu-table__th',
                  col.sortable && 'niuu-table__th--sortable',
                  sortState?.key === col.key && 'niuu-table__th--sorted',
                )}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                aria-sort={
                  sortState?.key === col.key
                    ? sortState.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : col.sortable
                      ? 'none'
                      : undefined
                }
                onClick={col.sortable ? () => handleHeaderSort(col) : undefined}
              >
                <span className="niuu-table__th-inner">
                  {col.header}
                  {col.sortable && (
                    <SortIcon
                      direction={sortState?.key === col.key ? sortState.direction : undefined}
                    />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="niuu-table__body">
          {rows.length === 0 && emptyState && (
            <tr>
              <td
                colSpan={columns.length + (selectable ? 1 : 0) + (hasExpand ? 1 : 0)}
                className="niuu-table__empty-cell"
              >
                {emptyState}
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const key = getRowKey(row);
            const isSelected = selectedKeys?.has(key) ?? false;
            const isExpanded = expandedKeys?.has(key) ?? false;

            return (
              <Fragment key={key}>
                <tr
                  className={cn(
                    'niuu-table__row',
                    isSelected && 'niuu-table__row--selected',
                    isExpanded && 'niuu-table__row--expanded',
                  )}
                  aria-selected={selectable ? isSelected : undefined}
                >
                  {selectable && (
                    <td className="niuu-table__td niuu-table__td--check">
                      <input
                        type="checkbox"
                        className="niuu-table__checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectRow(key)}
                        aria-label={`Select row ${key}`}
                      />
                    </td>
                  )}
                  {hasExpand && (
                    <td className="niuu-table__td niuu-table__td--expand">
                      <button
                        type="button"
                        className={cn(
                          'niuu-table__expand-btn',
                          isExpanded && 'niuu-table__expand-btn--open',
                        )}
                        onClick={() => handleExpandRow(key)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className="niuu-table__td">
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
                {hasExpand && isExpanded && (
                  <tr className="niuu-table__row niuu-table__row--detail">
                    <td
                      colSpan={columns.length + (selectable ? 1 : 0) + (hasExpand ? 1 : 0)}
                      className="niuu-table__td niuu-table__td--detail"
                    >
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
