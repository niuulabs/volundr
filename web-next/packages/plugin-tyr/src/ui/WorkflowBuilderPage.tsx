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
import { StateDot, cn } from '@niuulabs/ui';
import type { Workflow } from '../domain/workflow';
import { useWorkflows, useCreateWorkflow, useDeleteWorkflow } from './useWorkflows';
import { WorkflowBuilder } from './WorkflowBuilder';

export function WorkflowBuilderPage() {
  const { data: workflows, isLoading, isError, error } = useWorkflows();
  const [activeWorkflow, setActiveWorkflow] = useState<Workflow | null>(null);
  const createMutation = useCreateWorkflow();
  const deleteMutation = useDeleteWorkflow();

  const displayed = activeWorkflow ?? workflows?.[0] ?? null;

  function handleNew() {
    createMutation.mutate(undefined, {
      onSuccess: (newWf) => setActiveWorkflow(newWf),
    });
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id, {
      onSuccess: () => setActiveWorkflow(null),
    });
  }

  return (
    <div
      data-testid="workflow-builder-page"
      className="niuu-flex niuu-flex-col niuu-h-full niuu-font-sans niuu-bg-bg-primary niuu-min-h-screen"
    >
      {/* Page header */}
      <div className="niuu-py-3 niuu-px-5 niuu-border-b niuu-border-border niuu-bg-bg-secondary niuu-flex niuu-items-center niuu-gap-3">
        <h2 className="niuu-m-0 niuu-text-base niuu-font-semibold niuu-text-text-primary">
          Workflows
        </h2>

        {/* Workflow tabs */}
        {workflows && workflows.length > 0 && (
          <div className="niuu-flex niuu-gap-1">
            {workflows.map((wf: Workflow) => {
              const isActive = displayed?.id === wf.id;
              return (
                <div key={wf.id} className="niuu-flex niuu-items-center">
                  <button
                    data-testid={`workflow-tab-${wf.id}`}
                    onClick={() => setActiveWorkflow(wf)}
                    className={cn(
                      'niuu-rounded niuu-px-3 niuu-py-1 niuu-text-xs niuu-cursor-pointer niuu-font-sans niuu-border niuu-transition-colors',
                      isActive
                        ? 'niuu-bg-bg-elevated niuu-border-border niuu-text-text-primary'
                        : 'niuu-bg-transparent niuu-border-transparent niuu-text-text-muted',
                    )}
                  >
                    {wf.name}
                  </button>
                  {isActive && (
                    <button
                      data-testid={`delete-workflow-${wf.id}`}
                      onClick={() => handleDelete(wf.id)}
                      aria-label={`Delete workflow ${wf.name}`}
                      className="niuu-ml-1 niuu-text-text-muted hover:niuu-text-critical niuu-cursor-pointer niuu-border-none niuu-bg-transparent niuu-text-xs niuu-p-0 niuu-leading-none niuu-transition-colors"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* New workflow button */}
        <button
          data-testid="new-workflow"
          onClick={handleNew}
          disabled={createMutation.isPending}
          className="niuu-ml-auto niuu-rounded niuu-px-3 niuu-py-1 niuu-text-xs niuu-border niuu-border-border niuu-bg-bg-elevated niuu-text-text-secondary niuu-cursor-pointer hover:niuu-text-text-primary niuu-transition-colors niuu-font-sans disabled:niuu-opacity-50"
        >
          + New
        </button>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="niuu-flex-1 niuu-flex niuu-items-center niuu-justify-center niuu-gap-2 niuu-text-text-secondary niuu-text-sm">
          <StateDot state="processing" pulse />
          <span>Loading workflows…</span>
        </div>
      )}

      {isError && (
        <div className="niuu-flex-1 niuu-flex niuu-items-center niuu-justify-center niuu-gap-2 niuu-text-critical niuu-text-sm">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'Failed to load workflows'}</span>
        </div>
      )}

      {!isLoading && !isError && displayed && (
        <div className="niuu-flex-1 niuu-flex niuu-flex-col niuu-min-h-0">
          <WorkflowBuilder
            key={displayed.id}
            initialWorkflow={displayed}
            onSave={(updated) => setActiveWorkflow(updated)}
          />
        </div>
      )}

      {!isLoading && !isError && !displayed && (
        <div className="niuu-flex-1 niuu-flex niuu-items-center niuu-justify-center niuu-text-text-muted niuu-text-sm">
          No workflows found.
        </div>
      )}
    </div>
  );
}
