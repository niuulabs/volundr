import { useState } from 'react';
import { StateDot, Chip } from '@niuulabs/ui';
import { useLint } from '../application/useLint';
import { useRavns } from '../application/useRavns';
import { LintBadge } from './LintBadge';
import type { LintIssue, IssueSeverity, LintRule } from '../domain/lint';
import './LintPage.css';

const SEVERITY_ORDER: IssueSeverity[] = ['error', 'warn', 'info'];

const RULE_DESCRIPTIONS: Record<LintRule, string> = {
  L01: 'Contradiction between pages',
  L02: 'Stale source (page not recompiled)',
  L05: 'Broken wikilink',
  L07: 'Orphan page (no inbound links)',
  L11: 'Stale mount index',
  L12: 'Invalid frontmatter',
};

interface IssueSeverityFilterProps {
  active: IssueSeverity | null;
  onChange: (s: IssueSeverity | null) => void;
}

function SeverityFilter({ active, onChange }: IssueSeverityFilterProps) {
  return (
    <div className="lint-page__severity-filter" role="group" aria-label="Filter by severity">
      <button
        className={['lint-page__filter-btn', active == null ? 'lint-page__filter-btn--active' : '']
          .filter(Boolean)
          .join(' ')}
        onClick={() => onChange(null)}
        aria-pressed={active == null}
      >
        All
      </button>
      {SEVERITY_ORDER.map((s) => (
        <button
          key={s}
          className={[
            'lint-page__filter-btn',
            `lint-page__filter-btn--${s}`,
            active === s ? 'lint-page__filter-btn--active' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onChange(active === s ? null : s)}
          aria-pressed={active === s}
          data-severity={s}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

interface IssueRowProps {
  issue: LintIssue;
  selected: boolean;
  onToggle: () => void;
  onAutoFix: () => void;
  isFixing: boolean;
}

function IssueRow({ issue, selected, onToggle, onAutoFix, isFixing }: IssueRowProps) {
  return (
    <li
      className={[
        'lint-page__issue',
        `lint-page__issue--${issue.severity}`,
        selected ? 'lint-page__issue--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid="lint-issue"
    >
      <input
        type="checkbox"
        className="lint-page__issue-check"
        checked={selected}
        onChange={onToggle}
        aria-label={`Select issue ${issue.id}`}
      />
      <div className="lint-page__issue-body">
        <div className="lint-page__issue-header">
          <Chip
            tone={
              issue.severity === 'error'
                ? 'default'
                : issue.severity === 'warn'
                  ? 'default'
                  : 'muted'
            }
          >
            {issue.severity}
          </Chip>
          <code className="lint-page__issue-rule" title={RULE_DESCRIPTIONS[issue.rule]}>
            {issue.rule}
          </code>
          <span className="lint-page__issue-page">{issue.page}</span>
          <Chip tone="muted">{issue.mount}</Chip>
          {issue.assignee && <span className="lint-page__issue-assignee">{issue.assignee}</span>}
        </div>
        <p className="lint-page__issue-message">{issue.message}</p>
      </div>
      {issue.autoFix && (
        <button
          className="lint-page__fix-btn"
          onClick={onAutoFix}
          disabled={isFixing}
          aria-label={`Auto-fix issue ${issue.id}`}
          data-testid="autofix-btn"
        >
          {isFixing ? '…' : 'Fix'}
        </button>
      )}
    </li>
  );
}

export function LintPage() {
  const {
    issues,
    summary,
    isLoading,
    isError,
    error,
    runAutoFix,
    reassignIssues,
    isFixing,
    isReassigning,
  } = useLint();
  const { data: ravns } = useRavns();
  const ravnIds = ravns?.map((r) => r.ravnId) ?? [];

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | null>(null);
  const [assignTarget, setAssignTarget] = useState('');

  const filtered = severityFilter ? issues.filter((i) => i.severity === severityFilter) : issues;

  const autoFixableIds = filtered.filter((i) => i.autoFix).map((i) => i.id);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((i) => i.id)));
    }
  }

  function handleBulkFix() {
    const fixable = [...selectedIds].filter((id) => {
      const issue = issues.find((i) => i.id === id);
      return issue?.autoFix;
    });
    if (fixable.length > 0) {
      runAutoFix(fixable);
      setSelectedIds(new Set());
    }
  }

  function handleBulkAssign() {
    if (selectedIds.size > 0 && assignTarget) {
      reassignIssues([...selectedIds], assignTarget);
      setSelectedIds(new Set());
    }
  }

  return (
    <div className="lint-page">
      <h2 className="lint-page__title">Lint</h2>

      {isLoading && (
        <div className="lint-page__status">
          <StateDot state="processing" pulse />
          <span>loading lint report…</span>
        </div>
      )}

      {isError && (
        <div className="lint-page__status">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'lint load failed'}</span>
        </div>
      )}

      {!isLoading && !isError && (
        <>
          <div className="lint-page__header">
            <LintBadge summary={summary} />
            {autoFixableIds.length > 0 && (
              <button
                className="lint-page__btn lint-page__btn--fix"
                onClick={() => runAutoFix()}
                disabled={isFixing}
                aria-label="Fix all auto-fixable issues"
                data-testid="fix-all-btn"
              >
                {isFixing ? 'fixing…' : `Fix all auto-fixable (${autoFixableIds.length})`}
              </button>
            )}
          </div>

          <SeverityFilter active={severityFilter} onChange={setSeverityFilter} />

          {/* Bulk actions bar */}
          {selectedIds.size > 0 && (
            <div className="lint-page__bulk-bar" data-testid="bulk-bar">
              <span className="lint-page__bulk-count">{selectedIds.size} selected</span>
              <button
                className="lint-page__btn"
                onClick={handleBulkFix}
                disabled={isFixing}
                aria-label="Fix selected issues"
                data-testid="bulk-fix-btn"
              >
                Fix selected
              </button>
              <select
                className="lint-page__assignee-select"
                value={assignTarget}
                onChange={(e) => setAssignTarget(e.target.value)}
                aria-label="Assign to ravn"
                data-testid="assignee-select"
              >
                <option value="">Assign to…</option>
                {ravnIds.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                className="lint-page__btn"
                onClick={handleBulkAssign}
                disabled={!assignTarget || isReassigning}
                aria-label="Apply assignment"
                data-testid="bulk-assign-btn"
              >
                {isReassigning ? 'assigning…' : 'Assign'}
              </button>
            </div>
          )}

          {filtered.length === 0 && (
            <p className="lint-page__empty">
              {severityFilter ? `No ${severityFilter} issues found.` : 'No issues found. ✓'}
            </p>
          )}

          {filtered.length > 0 && (
            <>
              <div className="lint-page__select-all">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  onChange={toggleSelectAll}
                  aria-label="Select all visible issues"
                  data-testid="select-all-checkbox"
                />
                <span className="lint-page__select-all-label">
                  {filtered.length} {filtered.length === 1 ? 'issue' : 'issues'}
                </span>
              </div>

              <ul className="lint-page__issues" aria-label="Lint issues">
                {filtered.map((issue) => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    selected={selectedIds.has(issue.id)}
                    onToggle={() => toggleSelect(issue.id)}
                    onAutoFix={() => runAutoFix([issue.id])}
                    isFixing={isFixing}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
