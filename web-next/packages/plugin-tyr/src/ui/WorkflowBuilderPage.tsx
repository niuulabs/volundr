/**
 * WorkflowBuilderPage — the /tyr/workflows route component.
 *
 * Layout matches web2 prototype: templates sidebar on the left with a list
 * of saved workflows + working copy section, and the full WorkflowBuilder
 * filling the remaining space.
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
    if (!window.confirm('Delete this workflow?')) return;
    deleteMutation.mutate(id, {
      onSuccess: () => setActiveWorkflow(null),
    });
  }

  return (
    <div
      data-testid="workflow-builder-page"
      className="niuu-flex niuu-h-full niuu-font-sans niuu-bg-bg-primary"
    >
      {/* Templates sidebar */}
      <aside className="niuu-w-[220px] niuu-shrink-0 niuu-border-r niuu-border-border niuu-bg-bg-secondary niuu-flex niuu-flex-col niuu-overflow-hidden">
        {/* Header */}
        <div className="niuu-flex niuu-items-center niuu-justify-between niuu-px-4 niuu-pt-3 niuu-pb-1">
          <span className="niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-widest niuu-text-text-muted niuu-font-sans">
            TEMPLATES
          </span>
          <button
            data-testid="new-workflow"
            onClick={handleNew}
            disabled={createMutation.isPending}
            className="niuu-rounded niuu-px-2 niuu-py-0.5 niuu-text-[10px] niuu-border niuu-border-border niuu-bg-bg-elevated niuu-text-text-secondary niuu-cursor-pointer hover:niuu-text-text-primary niuu-transition-colors niuu-font-sans disabled:niuu-opacity-50"
          >
            + new
          </button>
        </div>
        <p className="niuu-text-[10px] niuu-text-text-faint niuu-font-mono niuu-m-0 niuu-px-4 niuu-pb-2 niuu-leading-snug">
          Reusable saga pipelines.{'\n'}Versioned, used by dispatch.
        </p>

        {/* Template list */}
        <div className="niuu-flex-1 niuu-overflow-y-auto niuu-px-2">
          {isLoading && (
            <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-text-text-secondary niuu-text-xs niuu-px-2 niuu-py-3">
              <StateDot state="processing" pulse />
              <span>Loading…</span>
            </div>
          )}

          {isError && (
            <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-text-critical niuu-text-xs niuu-px-2 niuu-py-3">
              <StateDot state="failed" />
              <span>{error instanceof Error ? error.message : 'Load failed'}</span>
            </div>
          )}

          {workflows?.map((wf: Workflow) => {
            const isActive = displayed?.id === wf.id;
            return (
              <button
                key={wf.id}
                data-testid={`workflow-tab-${wf.id}`}
                onClick={() => setActiveWorkflow(wf)}
                className={cn(
                  'niuu-flex niuu-items-center niuu-gap-2 niuu-w-full niuu-px-2.5 niuu-py-2 niuu-rounded niuu-border-none niuu-text-left niuu-font-sans niuu-text-xs niuu-cursor-pointer niuu-transition-colors',
                  isActive
                    ? 'niuu-bg-bg-elevated niuu-text-text-primary'
                    : 'niuu-bg-transparent niuu-text-text-secondary hover:niuu-bg-bg-tertiary',
                )}
              >
                <span className="niuu-text-brand niuu-text-sm">◇</span>
                <span className="niuu-flex-1 niuu-truncate niuu-font-semibold">
                  {wf.name.length > 18 ? wf.name.slice(0, 16) + '…' : wf.name}
                </span>
                {wf.version && (
                  <span className="niuu-text-text-faint niuu-font-mono niuu-text-[10px] niuu-shrink-0">
                    v{wf.version}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Working copy */}
        <div className="niuu-border-t niuu-border-border niuu-px-4 niuu-py-2">
          <span className="niuu-text-[10px] niuu-font-semibold niuu-uppercase niuu-tracking-widest niuu-text-text-muted niuu-font-sans">
            WORKING COPY
          </span>
          <div className="niuu-flex niuu-items-center niuu-gap-2 niuu-mt-1">
            <span className="niuu-text-brand niuu-text-xs">◆</span>
            <span className="niuu-text-xs niuu-text-text-secondary niuu-font-sans">
              Current draft
            </span>
            <span className="niuu-text-[10px] niuu-text-text-faint niuu-font-mono niuu-ml-auto">
              unsaved
            </span>
          </div>
        </div>

        {/* Delete active */}
        {displayed && (
          <div className="niuu-border-t niuu-border-border niuu-px-4 niuu-py-2">
            <button
              data-testid={`delete-workflow-${displayed.id}`}
              onClick={() => handleDelete(displayed.id)}
              className="niuu-text-[10px] niuu-text-text-faint niuu-bg-transparent niuu-border-none niuu-cursor-pointer niuu-p-0 hover:niuu-text-critical niuu-transition-colors niuu-font-sans"
            >
              Delete workflow
            </button>
          </div>
        )}
      </aside>

      {/* Workflow builder */}
      {displayed && (
        <div className="niuu-flex-1 niuu-flex niuu-flex-col niuu-min-h-0 niuu-min-w-0">
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
