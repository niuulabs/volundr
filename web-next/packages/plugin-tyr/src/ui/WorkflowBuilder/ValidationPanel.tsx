/**
 * ValidationPanel — floating pill showing live workflow validation issues.
 *
 * Runs `validateWorkflowFull` on every render (synchronous, cheap for
 * typical workflow sizes). Clicking an issue calls `onSelectNode` so the
 * graph can scroll/highlight the offending node.
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import { useState, useMemo } from 'react';
import { cn } from '@niuulabs/ui';
import type { Workflow } from '../../domain/workflow';
import type { WorkflowIssue } from '../../domain/workflowValidation';
import { validateWorkflowFull } from '../../domain/workflowValidation';

export interface ValidationPanelProps {
  workflow: Workflow;
  onSelectNode: (id: string) => void;
}

const KIND_ICON: Record<WorkflowIssue['kind'], string> = {
  cycle: '↻',
  orphan: '○',
  dangling_condition: '⚡',
  confidence_underset: '?',
  missing_persona: '👤',
  no_producer: '←',
  no_consumer: '→',
};

export function ValidationPanel({ workflow, onSelectNode }: ValidationPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const issues = useMemo(() => validateWorkflowFull(workflow), [workflow]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;

  const label =
    issues.length === 0
      ? '✓ No issues'
      : `${errorCount > 0 ? `${errorCount} error${errorCount !== 1 ? 's' : ''}` : ''}${errorCount > 0 && warnCount > 0 ? ', ' : ''}${warnCount > 0 ? `${warnCount} warning${warnCount !== 1 ? 's' : ''}` : ''}`;

  const severityClasses =
    errorCount > 0
      ? { text: 'niuu-text-critical', border: 'niuu-border-critical', bg: 'niuu-bg-critical' }
      : warnCount > 0
        ? {
            text: 'niuu-text-status-amber',
            border: 'niuu-border-status-amber',
            bg: 'niuu-bg-status-amber',
          }
        : {
            text: 'niuu-text-status-emerald',
            border: 'niuu-border-status-emerald',
            bg: 'niuu-bg-status-emerald',
          };

  return (
    <div
      data-testid="validation-panel"
      className="niuu-absolute niuu-bottom-[72px] niuu-left-1/2 niuu--translate-x-1/2 niuu-z-20 niuu-flex niuu-flex-col niuu-items-center niuu-gap-1 niuu-pointer-events-none"
    >
      {/* Issue list */}
      {expanded && issues.length > 0 && (
        <div className="niuu-bg-bg-secondary niuu-border niuu-border-border niuu-rounded-md niuu-py-1.5 niuu-px-1 niuu-min-w-[280px] niuu-max-w-[400px] niuu-max-h-[240px] niuu-overflow-y-auto niuu-shadow-md niuu-pointer-events-auto">
          {issues.map((issue, idx) => (
            <button
              key={idx}
              data-testid={`validation-issue-${issue.nodeId ?? 'global'}`}
              data-kind={issue.kind}
              onClick={() => {
                if (issue.nodeId) onSelectNode(issue.nodeId);
              }}
              className={cn(
                'niuu-flex niuu-items-start niuu-gap-2 niuu-w-full niuu-px-2.5 niuu-py-1.5 niuu-bg-transparent niuu-border-none niuu-rounded niuu-text-left niuu-font-sans',
                issue.nodeId
                  ? 'niuu-cursor-pointer hover:niuu-bg-bg-elevated'
                  : 'niuu-cursor-default',
              )}
            >
              <span
                className={cn(
                  'niuu-shrink-0 niuu-text-sm niuu-leading-snug niuu-w-[18px] niuu-text-center',
                  issue.severity === 'error' ? 'niuu-text-critical' : 'niuu-text-status-amber',
                )}
              >
                {KIND_ICON[issue.kind]}
              </span>
              <span className="niuu-text-xs niuu-text-text-secondary niuu-leading-snug">
                {issue.message}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Pill toggle */}
      <button
        data-testid="validation-pill"
        data-issue-count={issues.length}
        onClick={() => setExpanded((e) => !e)}
        className={cn(
          'niuu-pointer-events-auto niuu-bg-bg-secondary niuu-rounded-full niuu-py-1 niuu-px-3.5 niuu-text-xs niuu-font-medium niuu-cursor-pointer niuu-shadow-sm niuu-flex niuu-items-center niuu-gap-1.5 niuu-border niuu-transition-colors',
          severityClasses.text,
          severityClasses.border,
        )}
      >
        <span
          className={cn(
            'niuu-w-[7px] niuu-h-[7px] niuu-rounded-full niuu-shrink-0',
            severityClasses.bg,
          )}
        />
        {label}
        {issues.length > 0 && (
          <span className="niuu-opacity-60 niuu-text-xs">{expanded ? '▲' : '▼'}</span>
        )}
      </button>
    </div>
  );
}
