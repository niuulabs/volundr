import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';
import './FilterBar.css';

// ── Types ──────────────────────────────────────────────────────────────────

export type FilterValue = string | string[] | boolean | undefined;

export type FilterRecord = Record<string, FilterValue>;

/**
 * Serialize a FilterRecord to URLSearchParams-compatible entries.
 * Designed for use with TanStack Router search params:
 *
 * ```ts
 * const navigate = useNavigate();
 * const search = useSearch({ from: '/my-route' });
 * <FilterBar
 *   value={deserializeFilters(search)}
 *   onChange={(v) => navigate({ search: serializeFilters(v) })}
 * />
 * ```
 */
export function serializeFilters(filters: FilterRecord): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined) continue;
    if (v === false) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) out[k] = v;
    } else if (typeof v === 'boolean') {
      out[k] = 'true';
    } else {
      if (v !== '') out[k] = v;
    }
  }
  return out;
}

export function deserializeFilters(
  params: Record<string, string | string[] | undefined>,
): FilterRecord {
  const out: FilterRecord = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

// ── FilterChip ─────────────────────────────────────────────────────────────

export interface FilterChipProps {
  label: string;
  value?: string;
  onRemove: () => void;
  className?: string;
}

export function FilterChip({ label, value, onRemove, className }: FilterChipProps) {
  return (
    <span className={cn('niuu-filter-chip', className)}>
      <span className="niuu-filter-chip__label">{label}</span>
      {value !== undefined && (
        <>
          <span className="niuu-filter-chip__sep">:</span>
          <span className="niuu-filter-chip__value">{value}</span>
        </>
      )}
      <button
        type="button"
        className="niuu-filter-chip__remove"
        onClick={onRemove}
        aria-label={`Remove filter: ${label}`}
      >
        ×
      </button>
    </span>
  );
}

// ── FilterToggle ───────────────────────────────────────────────────────────

export interface FilterToggleProps {
  label: string;
  active: boolean;
  onToggle: (active: boolean) => void;
  className?: string;
}

export function FilterToggle({ label, active, onToggle, className }: FilterToggleProps) {
  return (
    <button
      type="button"
      className={cn('niuu-filter-toggle', active && 'niuu-filter-toggle--active', className)}
      onClick={() => onToggle(!active)}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

// ── FilterBar ──────────────────────────────────────────────────────────────

export interface FilterBarProps {
  /** Search text value (controlled) */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Slot for FilterChips and FilterToggles rendered next to the search */
  children?: ReactNode;
  /** Slot for additional controls on the right side (e.g. column picker, export) */
  actions?: ReactNode;
  className?: string;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  children,
  actions,
  className,
}: FilterBarProps) {
  return (
    <div className={cn('niuu-filter-bar', className)} role="search">
      {onSearchChange !== undefined && (
        <div className="niuu-filter-bar__search-wrap">
          <span className="niuu-filter-bar__search-icon" aria-hidden>
            ⌕
          </span>
          <input
            type="search"
            className="niuu-filter-bar__search"
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          {searchValue && (
            <button
              type="button"
              className="niuu-filter-bar__search-clear"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      )}
      {children && <div className="niuu-filter-bar__chips">{children}</div>}
      {actions && <div className="niuu-filter-bar__actions">{actions}</div>}
    </div>
  );
}
