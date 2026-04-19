/**
 * ValidationPanel — floating pill showing live workflow validation issues.
 *
 * Runs `validateWorkflowFull` on every render (synchronous, cheap for
 * typical workflow sizes). Clicking an issue calls `onSelectNode` so the
 * graph can scroll/highlight the offending node.
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import { useState } from 'react';
import type { Workflow } from '../../domain/workflow';
import type { WorkflowIssue } from '../../domain/workflowValidation';
import { validateWorkflowFull } from '../../domain/workflowValidation';

export interface ValidationPanelProps {
  workflow: Workflow;
  onSelectNode: (id: string) => void;
}

const SEVERITY_COLOR: Record<WorkflowIssue['severity'], string> = {
  error: 'var(--color-critical)',
  warning: 'var(--color-accent-amber)',
};

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
  const issues = validateWorkflowFull(workflow);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;

  const pillColor =
    errorCount > 0
      ? 'var(--color-critical)'
      : warnCount > 0
        ? 'var(--color-accent-amber)'
        : 'var(--color-accent-emerald)';

  const label =
    issues.length === 0
      ? '✓ No issues'
      : `${errorCount > 0 ? `${errorCount} error${errorCount !== 1 ? 's' : ''}` : ''}${errorCount > 0 && warnCount > 0 ? ', ' : ''}${warnCount > 0 ? `${warnCount} warning${warnCount !== 1 ? 's' : ''}` : ''}`;

  return (
    <div
      data-testid="validation-panel"
      style={{
        position: 'absolute',
        bottom: 72,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        pointerEvents: 'none',
      }}
    >
      {/* Issue list */}
      {expanded && issues.length > 0 && (
        <div
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: '6px 4px',
            minWidth: 280,
            maxWidth: 400,
            maxHeight: 240,
            overflowY: 'auto',
            boxShadow: 'var(--shadow-md)',
            pointerEvents: 'all',
          }}
        >
          {issues.map((issue, idx) => (
            <button
              key={idx}
              data-testid={`validation-issue-${issue.nodeId ?? 'global'}`}
              data-kind={issue.kind}
              onClick={() => {
                if (issue.nodeId) onSelectNode(issue.nodeId);
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                width: '100%',
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                cursor: issue.nodeId ? 'pointer' : 'default',
                borderRadius: 4,
                textAlign: 'left',
                fontFamily: 'var(--font-sans)',
              }}
              onMouseEnter={(e) => {
                if (issue.nodeId) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-elevated)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  color: SEVERITY_COLOR[issue.severity],
                  fontSize: 14,
                  lineHeight: 1.4,
                  width: 18,
                  textAlign: 'center',
                }}
              >
                {KIND_ICON[issue.kind]}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.4,
                }}
              >
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
        style={{
          pointerEvents: 'all',
          background: 'var(--color-bg-secondary)',
          border: `1px solid ${pillColor}`,
          borderRadius: 999,
          padding: '4px 14px',
          fontSize: 12,
          color: pillColor,
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          fontWeight: 500,
          boxShadow: 'var(--shadow-sm)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: pillColor,
            flexShrink: 0,
          }}
        />
        {label}
        {issues.length > 0 && (
          <span style={{ opacity: 0.6, fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
        )}
      </button>
    </div>
  );
}
