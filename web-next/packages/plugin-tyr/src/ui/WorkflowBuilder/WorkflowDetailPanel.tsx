/**
 * WorkflowDetailPanel — right-side metadata panel for the active workflow.
 *
 * Shows editable name/description fields plus read-only version, summary
 * stats, and validation badge counts.
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import type { Workflow } from '../../domain/workflow';

export interface WorkflowDetailPanelProps {
  workflow: Workflow;
  errorCount: number;
  warnCount: number;
}

export function WorkflowDetailPanel({ workflow, errorCount, warnCount }: WorkflowDetailPanelProps) {
  const stageCount = workflow.nodes.filter((n) => n.kind === 'stage').length;
  const gateCount = workflow.nodes.filter((n) => n.kind === 'gate').length;
  const condCount = workflow.nodes.filter((n) => n.kind === 'cond').length;
  const edgeCount = workflow.edges.length;

  return (
    <div
      data-testid="workflow-detail-panel"
      className="niuu-w-[280px] niuu-shrink-0 niuu-border-l niuu-border-border niuu-bg-bg-secondary niuu-flex niuu-flex-col niuu-overflow-y-auto"
    >
      {/* Header */}
      <div className="niuu-px-4 niuu-pt-3 niuu-pb-2 niuu-border-b niuu-border-border">
        <div className="niuu-flex niuu-flex-col niuu-gap-0.5">
          <span className="niuu-text-sm niuu-font-semibold niuu-text-text-primary niuu-font-sans">
            Workflow
          </span>
          <span className="niuu-text-[10px] niuu-font-mono niuu-text-text-faint">
            Inspector and release summary
          </span>
        </div>
      </div>

      <div className="niuu-px-4 niuu-py-3 niuu-flex niuu-flex-col niuu-gap-4">
        {/* Name */}
        <div>
          <label className="niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-widest niuu-text-text-muted niuu-font-sans niuu-block niuu-mb-1">
            NAME
          </label>
          <div
            data-testid="detail-name"
            className="niuu-w-full niuu-py-1.5 niuu-px-2.5 niuu-bg-bg-tertiary niuu-border niuu-border-border-subtle niuu-rounded niuu-text-text-primary niuu-font-sans niuu-text-sm"
          >
            {workflow.name}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-widest niuu-text-text-muted niuu-font-sans niuu-block niuu-mb-1">
            DESCRIPTION
          </label>
          <div
            data-testid="detail-description"
            className="niuu-w-full niuu-py-1.5 niuu-px-2.5 niuu-bg-bg-tertiary niuu-border niuu-border-border-subtle niuu-rounded niuu-text-text-secondary niuu-font-sans niuu-text-xs niuu-min-h-[60px] niuu-leading-relaxed"
          >
            {workflow.description || 'No description.'}
          </div>
        </div>

        {/* Version */}
        <div>
          <label className="niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-widest niuu-text-text-muted niuu-font-sans niuu-block niuu-mb-1">
            VERSION
          </label>
          <span
            data-testid="detail-version"
            className="niuu-text-lg niuu-font-mono niuu-font-semibold niuu-text-text-primary"
          >
            v{workflow.version ?? '0.1.0'}
          </span>
        </div>

        {/* Summary */}
        <div>
          <label className="niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-widest niuu-text-text-muted niuu-font-sans niuu-block niuu-mb-1">
            SUMMARY
          </label>
          <p className="niuu-text-xs niuu-text-text-secondary niuu-font-sans niuu-m-0 niuu-mb-2">
            {stageCount} stages · {gateCount} gates · {condCount} conditions · {edgeCount} edges
          </p>
          <div className="niuu-flex niuu-gap-1.5">
            {errorCount > 0 && (
              <span
                data-testid="detail-err-badge"
                className="niuu-inline-flex niuu-items-center niuu-gap-1 niuu-rounded-full niuu-border niuu-border-critical niuu-bg-critical-bg niuu-px-2 niuu-py-0.5 niuu-text-xs niuu-font-mono niuu-font-semibold niuu-text-critical"
              >
                {errorCount} ERR
              </span>
            )}
            {warnCount > 0 && (
              <span
                data-testid="detail-warn-badge"
                className="niuu-inline-flex niuu-items-center niuu-gap-1 niuu-rounded-full niuu-border niuu-border-status-amber niuu-bg-status-amber/10 niuu-px-2 niuu-py-0.5 niuu-text-xs niuu-font-mono niuu-font-semibold niuu-text-status-amber"
              >
                {warnCount} WARN
              </span>
            )}
          </div>
        </div>

        <div>
          <label className="niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-widest niuu-text-text-muted niuu-font-sans niuu-block niuu-mb-1">
            OPERATIONS
          </label>
          <div className="niuu-rounded-md niuu-border niuu-border-border-subtle niuu-bg-bg-tertiary niuu-px-3 niuu-py-2.5 niuu-flex niuu-flex-col niuu-gap-2">
            <div className="niuu-flex niuu-items-center niuu-justify-between niuu-text-[10px] niuu-font-mono niuu-text-text-faint">
              <span>default lane</span>
              <span>ship/mainline</span>
            </div>
            <div className="niuu-flex niuu-items-center niuu-justify-between niuu-text-[10px] niuu-font-mono niuu-text-text-faint">
              <span>validation</span>
              <span>{errorCount > 0 ? 'blocked' : warnCount > 0 ? 'review' : 'ready'}</span>
            </div>
            <div className="niuu-flex niuu-items-center niuu-justify-between niuu-text-[10px] niuu-font-mono niuu-text-text-faint">
              <span>last saved</span>
              <span>mock fixture</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
