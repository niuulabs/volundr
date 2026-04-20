/**
 * LintPage — 2-column lint view (matches web2 prototype mm-lint-wrap layout).
 *
 * LEFT (220px): checks sidebar — All + per-rule rows with severity dot, id, name, count
 * RIGHT (1fr):  issues list filtered by selected check + bulk actions
 */

import { useState } from 'react';
import { StateDot } from '@niuulabs/ui';
import { useLint } from '../application/useLint';
import { LintBadge } from './LintBadge';
import type { LintRule, IssueSeverity } from '../domain/lint';
import './LintPage.css';

const RULE_DESCRIPTIONS: Record<LintRule, string> = {
  L01: 'Contradiction between pages',
  L02: 'Stale source (page not recompiled)',
  L05: 'Broken wikilink',
  L07: 'Orphan page (no inbound links)',
  L11: 'Stale mount index',
  L12: 'Invalid frontmatter',
};

const SEVERITY_DOT: Record<IssueSeverity, 'failed' | 'attention' | 'observing'> = {
  error: 'failed',
  warn: 'attention',
  info: 'observing',
};

export function LintPage() {
  const { issues, summary, isLoading, isError, error, runAutoFix, isFixing } = useLint();

  const [selectedRule, setSelectedRule] = useState<LintRule | null>(null);

  // Aggregate counts and max severity per rule
  const countByRule = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.rule] = (acc[issue.rule] ?? 0) + 1;
    return acc;
  }, {});

  const severityByRule = issues.reduce<Record<string, IssueSeverity>>((acc, issue) => {
    const cur = acc[issue.rule];
    if (
      !cur ||
      (issue.severity === 'error' && cur !== 'error') ||
      (issue.severity === 'warn' && cur === 'info')
    ) {
      acc[issue.rule] = issue.severity;
    }
    return acc;
  }, {});

  const rules = Object.keys(RULE_DESCRIPTIONS) as LintRule[];
  const filtered = selectedRule ? issues.filter((i) => i.rule === selectedRule) : issues;
  const autoFixableIds = filtered.filter((i) => i.autoFix).map((i) => i.id);
  const totalLint = summary.error + summary.warn + summary.info;

  if (isLoading) {
    return (
      <div className="lint-page lint-page--loading">
        <StateDot state="processing" pulse />
        <span>loading lint report…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="lint-page lint-page--error">
        <StateDot state="failed" />
        <span>{error instanceof Error ? error.message : 'lint load failed'}</span>
      </div>
    );
  }

  return (
    <div className="lint-page">
      {/* ── KPI strip ───────────────────────────────────────────── */}
      <div className="lint-page__kpi-strip">
        <div className="lint-page__kpi lint-page__kpi--warn">
          <span className="lint-page__kpi-lbl">total issues</span>
          <span className="lint-page__kpi-val">{totalLint}</span>
        </div>
        <div className="lint-page__kpi">
          <span className="lint-page__kpi-lbl">errors</span>
          <span
            className={`lint-page__kpi-val${summary.error > 0 ? ' lint-page__kpi-val--err' : ''}`}
          >
            {summary.error}
          </span>
        </div>
        <div className="lint-page__kpi">
          <span className="lint-page__kpi-lbl">warnings</span>
          <span className="lint-page__kpi-val lint-page__kpi-val--warn">{summary.warn}</span>
        </div>
        <div className="lint-page__kpi lint-page__kpi--accent">
          <span className="lint-page__kpi-lbl">auto-fixable</span>
          <span className="lint-page__kpi-val">{autoFixableIds.length}</span>
        </div>
      </div>

      {/* ── 2-column layout ─────────────────────────────────────── */}
      <div className="lint-page__wrap">
        {/* LEFT: checks sidebar */}
        <aside className="lint-page__sidebar" aria-label="Lint checks">
          <h4 className="lint-page__sidebar-title">Lint checks</h4>
          <button
            type="button"
            className={`lint-page__check-row${selectedRule === null ? ' lint-page__check-row--active' : ''}`}
            onClick={() => setSelectedRule(null)}
            aria-pressed={selectedRule === null}
          >
            <span className="lint-page__check-id">All</span>
            <span className="lint-page__check-name">every issue</span>
            <span className="lint-page__check-count">{totalLint}</span>
          </button>
          {rules.map((rule) => {
            const count = countByRule[rule] ?? 0;
            const sev: IssueSeverity = severityByRule[rule] ?? 'info';
            return (
              <button
                key={rule}
                type="button"
                className={`lint-page__check-row${selectedRule === rule ? ' lint-page__check-row--active' : ''}`}
                onClick={() => setSelectedRule(selectedRule === rule ? null : rule)}
                aria-pressed={selectedRule === rule}
                data-testid="check-row"
              >
                <div className="lint-page__check-id-cell">
                  <StateDot state={SEVERITY_DOT[sev]} size={6} />
                  <span className="lint-page__check-id">{rule}</span>
                </div>
                <div className="lint-page__check-desc-cell">
                  <span className="lint-page__check-name">{RULE_DESCRIPTIONS[rule]}</span>
                </div>
                <span
                  className={`lint-page__check-count${count === 0 ? ' lint-page__check-count--zero' : ''}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </aside>

        {/* RIGHT: issues list */}
        <div className="lint-page__issues-panel">
          <div className="lint-page__issues-header">
            <div>
              <LintBadge summary={summary} />
              <span className="lint-page__issues-rule-label">
                {selectedRule
                  ? `${selectedRule} — ${RULE_DESCRIPTIONS[selectedRule]}`
                  : 'All lint issues'}
              </span>
              <span className="lint-page__issues-count">· {filtered.length}</span>
            </div>
            <div className="lint-page__issues-actions">
              <button type="button" className="lint-page__btn" aria-label="Run lint">
                Run lint
              </button>
              {autoFixableIds.length > 0 && (
                <button
                  type="button"
                  className="lint-page__btn lint-page__btn--fix"
                  onClick={() => runAutoFix()}
                  disabled={isFixing}
                  aria-label="Fix all auto-fixable issues"
                  data-testid="fix-all-btn"
                >
                  {isFixing ? 'fixing…' : `Auto-fix (${autoFixableIds.length})`}
                </button>
              )}
            </div>
          </div>

          {filtered.length === 0 && (
            <p className="lint-page__empty">
              {selectedRule ? `No issues for ${selectedRule}.` : 'No issues found. ✓'}
            </p>
          )}

          <ul className="lint-page__list" aria-label="Lint issues">
            {filtered.map((issue, i) => (
              <li
                key={`${issue.rule}-${i}`}
                className={`lint-page__issue lint-page__issue--${issue.severity}`}
                data-testid="lint-issue"
              >
                <div className="lint-page__issue-id-cell">
                  <code className="lint-page__issue-rule">{issue.rule}</code>
                  <StateDot state={SEVERITY_DOT[issue.severity]} size={6} />
                </div>
                <div className="lint-page__issue-body">
                  <div className="lint-page__issue-page">{issue.page}</div>
                  <div className="lint-page__issue-message">{issue.message}</div>
                </div>
                <div className="lint-page__issue-actions">
                  {issue.autoFix && (
                    <button
                      type="button"
                      className="lint-page__btn"
                      onClick={() => runAutoFix([issue.id])}
                      disabled={isFixing}
                      aria-label={`Auto-fix issue ${issue.id}`}
                      data-testid="autofix-btn"
                    >
                      {isFixing ? '…' : 'Fix'}
                    </button>
                  )}
                  <span className="lint-page__issue-mount">{issue.mount}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
