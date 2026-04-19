/**
 * WorkflowBuilderPage — the /tyr/workflows route component.
 *
 * Shows a list of saved workflows and embeds the WorkflowBuilder for the
 * selected/active workflow. On first load, selects the first workflow
 * returned by IWorkflowService.
 *
 * Owner: plugin-tyr.
 */

import { useState } from 'react';
import { StateDot } from '@niuulabs/ui';
import type { Workflow } from '../domain/workflow';
import { useWorkflows } from './useWorkflows';
import { WorkflowBuilder } from './WorkflowBuilder';

export function WorkflowBuilderPage() {
  const { data: workflows, isLoading, isError, error } = useWorkflows();
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null);

  const displayed = activeWorkflow ?? workflows?.[0] ?? null;

  return (
    <div
      data-testid="workflow-builder-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'var(--font-sans)',
        background: 'var(--color-bg-primary)',
        minHeight: '100vh',
      }}
    >
      {/* Page header */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h2
          style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}
        >
          Workflows
        </h2>

        {/* Workflow tabs */}
        {workflows && workflows.length > 0 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {workflows.map((wf: Workflow) => {
              const isActive = displayed?.id === wf.id;
              return (
                <button
                  key={wf.id}
                  data-testid={`workflow-tab-${wf.id}`}
                  onClick={() => setActiveWorkflow(wf)}
                  style={{
                    background: isActive ? 'var(--color-bg-elevated)' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--color-border)' : 'transparent'}`,
                    borderRadius: 4,
                    padding: '4px 12px',
                    fontSize: 12,
                    color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {wf.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content */}
      {isLoading && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--color-text-secondary)',
            fontSize: 13,
          }}
        >
          <StateDot state="processing" pulse />
          <span>Loading workflows…</span>
        </div>
      )}

      {isError && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--color-critical)',
            fontSize: 13,
          }}
        >
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'Failed to load workflows'}</span>
        </div>
      )}

      {!isLoading && !isError && displayed && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <WorkflowBuilder
            key={displayed.id}
            initialWorkflow={displayed}
            onSave={(updated) => setActiveWorkflow(updated)}
          />
        </div>
      )}

      {!isLoading && !isError && !displayed && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-text-muted)',
            fontSize: 13,
          }}
        >
          No workflows found.
        </div>
      )}
    </div>
  );
}
