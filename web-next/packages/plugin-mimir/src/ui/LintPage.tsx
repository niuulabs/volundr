/**
 * LintPage — 2-column lint view (matches web2 prototype mm-lint-wrap layout).
 *
 * LEFT (220px): checks sidebar — All + per-rule rows with severity dot, id, name, count
 * RIGHT (1fr):  issues list filtered by selected check + bulk actions
 * DESCRIPTION:  rule info box (below issues header, shown when a rule is selected)
 */

import { useState } from 'react';
import { StateDot } from '@niuulabs/ui';
import { useLint } from '../application/useLint';
import { LintBadge } from './LintBadge';
import type { LintRule, IssueSeverity } from '../domain/lint';

const RULE_DESCRIPTIONS: Record<LintRule, string> = {
  L01: 'Contradiction between pages',
  L02: 'Stale source (page not recompiled)',
  L05: 'Broken wikilink',
  L07: 'Orphan page (no inbound links)',
  L11: 'Stale mount index',
  L12: 'Invalid frontmatter',
};

const RULE_FIX_HINTS: Record<LintRule, string> = {
  L01: 'Review conflicting statements across both pages and reconcile the contradiction.',
  L02: 'Recompile the page from its source to pull in the latest content.',
  L05: 'Update or remove the broken wikilink.',
  L07: 'Add inbound links from related pages, or archive if the page is no longer relevant.',
  L11: 'Run `mimir index --rebuild` to regenerate the mount index.',
  L12: 'Fix the YAML frontmatter syntax errors in the affected page.',
};

const SEVERITY_DOT: Record<IssueSeverity, 'failed' | 'attention' | 'observing'> = {
  error: 'failed',
  warn: 'attention',
  info: 'observing',
};

const SEVERITY_BADGE_CLS: Record<IssueSeverity, string> = {
  error: 'niuu-text-critical niuu-border-critical',
  warn: 'niuu-text-brand-400 niuu-border-brand-400',
  info: 'niuu-text-status-cyan niuu-border-status-cyan',
};

const ISSUE_BORDER_CLS: Record<IssueSeverity, string> = {
  error: 'niuu-border-l-[3px] niuu-border-l-critical',
  warn: 'niuu-border-l-[3px] niuu-border-l-brand-400',
  info: 'niuu-border-l-[3px] niuu-border-l-status-cyan',
};

const BTN_BASE =
  'niuu-py-1 niuu-px-3 niuu-rounded-md niuu-font-sans niuu-text-xs niuu-cursor-pointer niuu-whitespace-nowrap niuu-border disabled:niuu-opacity-50 disabled:niuu-cursor-not-allowed';
const BTN_SECONDARY = `${BTN_BASE} niuu-bg-bg-secondary niuu-border-border niuu-text-text-primary hover:niuu-bg-bg-tertiary`;
const BTN_FIX = `${BTN_BASE} niuu-bg-brand niuu-border-brand niuu-text-bg-primary niuu-font-medium hover:niuu-opacity-[0.88]`;

const CHECK_ROW_BASE =
  'niuu-grid niuu-grid-cols-[52px_1fr_28px] niuu-items-center niuu-gap-2 niuu-py-2 niuu-px-3 ' +
  'niuu-border-0 niuu-border-b niuu-border-solid niuu-border-border-subtle ' +
  'niuu-cursor-pointer niuu-text-left niuu-w-full niuu-transition-colors';

const KPI_CARD_BASE =
  'niuu-flex niuu-flex-col niuu-gap-[2px] niuu-py-3 niuu-px-4 niuu-bg-bg-secondary niuu-border niuu-rounded-md niuu-min-w-[80px]';
const KPI_LBL = 'niuu-text-[10px] niuu-uppercase niuu-tracking-[0.07em] niuu-text-text-muted';
const KPI_VAL_BASE = 'niuu-text-2xl niuu-font-medium niuu-font-mono niuu-tracking-[-0.01em]';

export function LintPage() {
  const { issues, summary, isLoading, isError, error, runAutoFix, isFixing } = useLint();
  const [selectedRule, setSelectedRule] = useState<LintRule | null>(null);

  const { countByRule, severityByRule, autoFixByRule } = issues.reduce<{
    countByRule: Record<string, number>;
    severityByRule: Record<string, IssueSeverity>;
    autoFixByRule: Record<string, boolean>;
  }>(
    (acc, issue) => {
      acc.countByRule[issue.rule] = (acc.countByRule[issue.rule] ?? 0) + 1;
      const cur = acc.severityByRule[issue.rule];
      if (
        !cur ||
        (issue.severity === 'error' && cur !== 'error') ||
        (issue.severity === 'warn' && cur === 'info')
      ) {
        acc.severityByRule[issue.rule] = issue.severity;
      }
      if (issue.autoFix) acc.autoFixByRule[issue.rule] = true;
      return acc;
    },
    { countByRule: {}, severityByRule: {}, autoFixByRule: {} },
  );

  const rules = Object.keys(RULE_DESCRIPTIONS) as LintRule[];
  const filtered = selectedRule ? issues.filter((i) => i.rule === selectedRule) : issues;
  // auto-fixable KPI always shows global count; filtered ids drive the Fix-all button
  const totalAutoFixable = issues.filter((i) => i.autoFix).length;
  const autoFixableIds = filtered.filter((i) => i.autoFix).map((i) => i.id);
  const totalLint = summary.error + summary.warn + summary.info;

  const kpis = [
    {
      label: 'total issues',
      value: totalLint,
      valueCls: `${KPI_VAL_BASE} niuu-text-brand-400`,
      cardBorder: 'niuu-border-brand-400',
    },
    {
      label: 'errors',
      value: summary.error,
      valueCls: `${KPI_VAL_BASE} ${summary.error > 0 ? 'niuu-text-critical-fg' : 'niuu-text-text-muted'}`,
      cardBorder: 'niuu-border-border-subtle',
    },
    {
      label: 'warnings',
      value: summary.warn,
      valueCls: `${KPI_VAL_BASE} niuu-text-brand-400`,
      cardBorder: 'niuu-border-border-subtle',
    },
    {
      label: 'auto-fixable',
      value: totalAutoFixable,
      valueCls: `${KPI_VAL_BASE} niuu-text-brand-300`,
      cardBorder: 'niuu-border-brand-300',
    },
  ];

  if (isLoading) {
    return (
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-text-text-secondary niuu-text-sm niuu-p-6">
        <StateDot state="processing" pulse />
        <span>loading lint report…</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-text-text-secondary niuu-text-sm niuu-p-6">
        <StateDot state="failed" />
        <span>{error instanceof Error ? error.message : 'lint load failed'}</span>
      </div>
    );
  }

  return (
    <div className="niuu-p-6 niuu-flex niuu-flex-col niuu-gap-4 niuu-h-full niuu-box-border">
      {/* ── KPI strip ───────────────────────────────────────────── */}
      <div className="niuu-flex niuu-gap-4 niuu-flex-wrap">
        {kpis.map((kpi) => (
          <div key={kpi.label} className={`${KPI_CARD_BASE} ${kpi.cardBorder}`}>
            <span className={KPI_LBL}>{kpi.label}</span>
            <span className={kpi.valueCls}>{kpi.value}</span>
          </div>
        ))}
      </div>

      {/* ── 2-column layout ─────────────────────────────────────── */}
      <div className="niuu-grid niuu-grid-cols-[220px_1fr] niuu-border niuu-border-border-subtle niuu-rounded-lg niuu-overflow-hidden niuu-flex-1 niuu-min-h-0">
        {/* LEFT: checks sidebar */}
        <aside
          className="niuu-border-r niuu-border-border-subtle niuu-bg-bg-secondary niuu-flex niuu-flex-col niuu-overflow-y-auto"
          aria-label="Lint checks"
        >
          <h4 className="niuu-py-3 niuu-px-4 niuu-m-0 niuu-text-xs niuu-uppercase niuu-tracking-[0.07em] niuu-text-text-muted niuu-border-b niuu-border-border-subtle niuu-shrink-0">
            Lint checks
          </h4>
          {/* F8: both rows reuse CHECK_ROW_BASE */}
          <button
            type="button"
            className={`${CHECK_ROW_BASE} ${selectedRule === null ? 'niuu-bg-bg-elevated' : 'niuu-bg-transparent hover:niuu-bg-bg-tertiary'}`}
            onClick={() => setSelectedRule(null)}
            aria-pressed={selectedRule === null}
          >
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-primary niuu-font-semibold">
              All
            </span>
            <span className="niuu-text-xs niuu-text-text-secondary niuu-whitespace-nowrap niuu-overflow-hidden niuu-text-ellipsis niuu-block">
              every issue
            </span>
            <span className="niuu-font-mono niuu-text-xs niuu-text-text-primary niuu-text-right">
              {totalLint}
            </span>
          </button>
          {rules.map((rule) => {
            const count = countByRule[rule] ?? 0;
            const sev: IssueSeverity = severityByRule[rule] ?? 'info';
            return (
              <button
                key={rule}
                type="button"
                className={`${CHECK_ROW_BASE} ${selectedRule === rule ? 'niuu-bg-bg-elevated' : 'niuu-bg-transparent hover:niuu-bg-bg-tertiary'}`}
                onClick={() => setSelectedRule(selectedRule === rule ? null : rule)}
                aria-pressed={selectedRule === rule}
                data-testid="check-row"
              >
                <div className="niuu-flex niuu-items-center niuu-gap-1">
                  <StateDot state={SEVERITY_DOT[sev]} size={6} />
                  <span className="niuu-font-mono niuu-text-xs niuu-text-text-primary niuu-font-semibold">
                    {rule}
                  </span>
                </div>
                <div className="niuu-overflow-hidden">
                  <span className="niuu-text-xs niuu-text-text-secondary niuu-whitespace-nowrap niuu-overflow-hidden niuu-text-ellipsis niuu-block">
                    {RULE_DESCRIPTIONS[rule]}
                  </span>
                </div>
                <span
                  className={`niuu-font-mono niuu-text-xs niuu-text-right ${
                    count === 0 ? 'niuu-text-text-muted' : 'niuu-text-text-primary'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </aside>

        {/* RIGHT: issues panel */}
        <div className="niuu-flex niuu-flex-col niuu-overflow-hidden niuu-bg-bg-primary">
          {/* Issues header */}
          <div className="niuu-flex niuu-items-center niuu-justify-between niuu-py-3 niuu-px-4 niuu-border-b niuu-border-border-subtle niuu-bg-bg-secondary niuu-shrink-0 niuu-flex-wrap niuu-gap-2">
            <div className="niuu-flex niuu-items-center niuu-gap-2">
              <LintBadge summary={summary} />
              <span className="niuu-text-sm niuu-font-medium niuu-text-text-primary">
                {selectedRule
                  ? `${selectedRule} — ${RULE_DESCRIPTIONS[selectedRule]}`
                  : 'All lint issues'}
              </span>
              <span className="niuu-text-xs niuu-font-mono niuu-text-text-muted">
                · {filtered.length}
              </span>
            </div>
            <div className="niuu-flex niuu-gap-2">
              <button type="button" className={BTN_SECONDARY} aria-label="Run lint">
                Run lint
              </button>
              {autoFixableIds.length > 0 && (
                <button
                  type="button"
                  className={BTN_FIX}
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

          {/* Rule description box — shown when a specific rule is selected */}
          {selectedRule && (
            <div
              className="niuu-mx-4 niuu-mt-3 niuu-mb-1 niuu-p-3 niuu-bg-bg-secondary niuu-border niuu-border-border-subtle niuu-rounded-md niuu-shrink-0"
              data-testid="rule-description"
            >
              <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-flex-wrap niuu-mb-1">
                <code className="niuu-font-mono niuu-text-xs niuu-text-brand-300 niuu-font-semibold">
                  {selectedRule}
                </code>
                <span className="niuu-text-xs niuu-text-text-secondary">—</span>
                <span className="niuu-text-xs niuu-text-text-secondary">
                  {RULE_DESCRIPTIONS[selectedRule]}
                </span>
                <span
                  className={`niuu-font-mono niuu-text-[10px] niuu-px-2 niuu-rounded-full niuu-border ${
                    SEVERITY_BADGE_CLS[severityByRule[selectedRule] ?? 'info']
                  }`}
                >
                  {severityByRule[selectedRule] ?? 'info'}
                </span>
                {autoFixByRule[selectedRule] && (
                  <span className="niuu-font-mono niuu-text-[10px] niuu-px-2 niuu-rounded-full niuu-border niuu-text-status-emerald niuu-border-status-emerald">
                    auto-fix
                  </span>
                )}
              </div>
              <p className="niuu-m-0 niuu-text-xs niuu-text-text-muted niuu-leading-relaxed">
                <span className="niuu-font-medium niuu-text-text-secondary">How to fix: </span>
                {RULE_FIX_HINTS[selectedRule]}
                {autoFixByRule[selectedRule] && (
                  <span className="niuu-text-status-emerald">
                    {' '}
                    Auto-fixable via <code className="niuu-font-mono">mimir_lint --fix</code>.
                  </span>
                )}
              </p>
            </div>
          )}

          {filtered.length === 0 && (
            <p className="niuu-p-4 niuu-text-text-muted niuu-text-sm niuu-m-0">
              {selectedRule ? `No issues for ${selectedRule}.` : 'No issues found. ✓'}
            </p>
          )}

          <ul
            className="niuu-list-none niuu-p-0 niuu-m-0 niuu-overflow-y-auto niuu-flex-1"
            aria-label="Lint issues"
          >
            {filtered.map((issue, i) => (
              <li
                key={`${issue.rule}-${i}`}
                className={[
                  'niuu-grid niuu-grid-cols-[64px_1fr_auto] niuu-gap-3 niuu-items-start niuu-py-3 niuu-px-4',
                  'niuu-border-b niuu-border-b-border-subtle last:niuu-border-b-0',
                  ISSUE_BORDER_CLS[issue.severity],
                ].join(' ')}
                data-testid="lint-issue"
              >
                <div className="niuu-flex niuu-items-center niuu-gap-1 niuu-pt-[2px]">
                  <code className="niuu-font-mono niuu-text-xs niuu-bg-bg-tertiary niuu-px-2 niuu-py-[2px] niuu-rounded-sm niuu-text-text-secondary">
                    {issue.rule}
                  </code>
                  <StateDot state={SEVERITY_DOT[issue.severity]} size={6} />
                </div>
                <div className="niuu-min-w-0">
                  <div className="niuu-font-mono niuu-text-xs niuu-text-text-secondary niuu-whitespace-nowrap niuu-overflow-hidden niuu-text-ellipsis niuu-mb-1">
                    {issue.page}
                  </div>
                  <div className="niuu-text-sm niuu-text-text-secondary niuu-break-words">
                    {issue.message}
                  </div>
                </div>
                <div className="niuu-flex niuu-flex-col niuu-items-end niuu-gap-1">
                  {issue.autoFix && (
                    <button
                      type="button"
                      className={BTN_SECONDARY}
                      onClick={() => runAutoFix([issue.id])}
                      disabled={isFixing}
                      aria-label={`Auto-fix issue ${issue.id}`}
                      data-testid="autofix-btn"
                    >
                      {isFixing ? '…' : 'Fix'}
                    </button>
                  )}
                  <span className="niuu-font-mono niuu-text-[10px] niuu-text-text-muted niuu-whitespace-nowrap">
                    {issue.mount}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
