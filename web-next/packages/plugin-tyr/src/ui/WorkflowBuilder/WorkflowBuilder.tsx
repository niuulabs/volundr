/**
 * WorkflowBuilder — three-view DAG editor for Tyr Workflows.
 *
 * Layout matches web2 prototype:
 *   LEFT:   LibraryPanel (blocks + personas)
 *   CENTER: header bar + action bar + canvas + bottom bar with zoom controls
 *   RIGHT:  WorkflowDetailPanel (name, description, version, summary)
 *
 * Views:
 *  • Graph   — pan/zoom SVG canvas with node/edge editing
 *  • Pipeline — read-only topological layout
 *  • YAML    — read-only pretty-printed YAML
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import { useMemo } from 'react';
import { cn } from '@niuulabs/ui';
import type { Workflow } from '../../domain/workflow';
import { validateWorkflowFull } from '../../domain/workflowValidation';
import { useWorkflowBuilder, type WorkflowView } from './useWorkflowBuilder';
import { GraphView } from './GraphView';
import { PipelineView } from './PipelineView';
import { YamlView } from './YamlView';
import { ValidationPanel } from './ValidationPanel';
import { NodeInspector } from './NodeInspector';
import { LibraryPanel, DEFAULT_PERSONAS, type PersonaEntry } from './LibraryPanel';
import { WorkflowDetailPanel } from './WorkflowDetailPanel';

export interface WorkflowBuilderProps {
  /** Initial workflow to edit. */
  initialWorkflow: Workflow;
  /** Called whenever the workflow is mutated. */
  onSave?: (workflow: Workflow) => void;
  /** Override persona library (defaults to DEFAULT_PERSONAS). */
  personas?: PersonaEntry[];
}

const VIEWS: WorkflowView[] = ['graph', 'pipeline', 'yaml'];

const VIEW_LABELS: Record<WorkflowView, string> = {
  graph: 'Graph',
  pipeline: 'Pipeline',
  yaml: 'YAML',
};

const ACTION_BTN =
  'niuu-bg-transparent niuu-border niuu-border-solid niuu-border-border-subtle niuu-rounded niuu-text-text-secondary niuu-font-sans niuu-text-xs niuu-py-1 niuu-px-2.5 niuu-cursor-pointer niuu-whitespace-nowrap hover:niuu-border-border hover:niuu-text-text-primary niuu-transition-colors';

export function WorkflowBuilder({ initialWorkflow, onSave, personas }: WorkflowBuilderProps) {
  const builder = useWorkflowBuilder(initialWorkflow);
  const {
    workflow,
    view,
    selectedNodeId,
    connectingFromId,
    inspectorNodeId,
    setView,
    selectNode,
    inspectNode,
    addNode,
    deleteNode,
    moveNode,
    startConnect,
    cancelConnect,
    completeConnect,
    removePersonaFromStage,
    updateNodeLabel,
    setWorkflow: _setWorkflow,
  } = builder;

  const issues = useMemo(() => validateWorkflowFull(workflow), [workflow]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;

  const inspectorNode = inspectorNodeId
    ? (workflow.nodes.find((n) => n.id === inspectorNodeId) ?? null)
    : null;

  function handleSave() {
    onSave?.(workflow);
  }

  return (
    <div
      data-testid="workflow-builder"
      className="niuu-flex niuu-h-full niuu-min-h-[600px] niuu-font-sans"
    >
      {/* Library panel — left of canvas */}
      {view === 'graph' && <LibraryPanel personas={personas ?? DEFAULT_PERSONAS} />}

      {/* Center: header + action bar + canvas + bottom bar */}
      <div className="niuu-flex-1 niuu-flex niuu-flex-col niuu-min-w-0">
        {/* Header bar */}
        <div className="niuu-flex niuu-items-center niuu-py-2 niuu-px-4 niuu-border-b niuu-border-border niuu-bg-bg-secondary niuu-shrink-0 niuu-gap-3">
          <h3
            className="niuu-m-0 niuu-text-sm niuu-font-semibold niuu-text-text-primary niuu-whitespace-nowrap"
            data-testid="builder-title"
          >
            {workflow.name}
          </h3>

          {workflow.version && (
            <span
              className="niuu-text-[10px] niuu-font-mono niuu-text-text-muted niuu-bg-bg-elevated niuu-border niuu-border-border niuu-rounded niuu-px-1.5 niuu-py-0.5"
              data-testid="builder-version"
            >
              v{workflow.version}
            </span>
          )}

          {/* View tabs */}
          <div className="niuu-flex niuu-gap-0.5">
            {VIEWS.map((v) => (
              <button
                key={v}
                data-testid={`tab-${v}`}
                data-active={view === v ? 'true' : undefined}
                onClick={() => setView(v)}
                className={cn(
                  'niuu-rounded niuu-px-3 niuu-py-1 niuu-text-xs niuu-cursor-pointer niuu-font-sans niuu-border niuu-transition-colors',
                  view === v
                    ? 'niuu-bg-brand niuu-border-brand niuu-text-bg-primary'
                    : 'niuu-bg-transparent niuu-border-transparent niuu-text-text-muted',
                )}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>

          {/* Spacer + toolbar buttons */}
          <div className="niuu-flex niuu-items-center niuu-gap-1 niuu-ml-auto">
            <button
              type="button"
              className="niuu-bg-transparent niuu-border-none niuu-text-text-muted niuu-cursor-pointer niuu-text-sm niuu-p-1 hover:niuu-text-text-secondary"
              title="Undo"
              aria-label="Undo"
            >
              ↺
            </button>
            <button
              type="button"
              className="niuu-bg-transparent niuu-border-none niuu-text-text-muted niuu-cursor-pointer niuu-text-sm niuu-p-1 hover:niuu-text-text-secondary"
              title="Redo"
              aria-label="Redo"
            >
              ↻
            </button>
            <button type="button" className={ACTION_BTN} data-testid="btn-diff">
              Diff
            </button>
          </div>
        </div>

        {/* Action bar */}
        <div
          className="niuu-flex niuu-items-center niuu-gap-2 niuu-py-1.5 niuu-px-4 niuu-border-b niuu-border-border niuu-bg-bg-secondary niuu-shrink-0"
          data-testid="action-bar"
        >
          <button type="button" className={ACTION_BTN}>
            History
          </button>
          {onSave && (
            <button type="button" className={ACTION_BTN} data-testid="save-workflow" onClick={handleSave}>
              Save as…
            </button>
          )}
          <button
            type="button"
            className="niuu-bg-transparent niuu-border niuu-border-solid niuu-border-brand niuu-rounded niuu-text-brand niuu-font-sans niuu-text-xs niuu-py-1 niuu-px-2.5 niuu-cursor-pointer niuu-whitespace-nowrap hover:niuu-bg-brand/10 niuu-transition-colors niuu-flex niuu-items-center niuu-gap-1"
            data-testid="btn-test"
          >
            <span>▶</span> Test
          </button>
          <button
            type="button"
            className="niuu-bg-transparent niuu-border niuu-border-solid niuu-border-status-amber niuu-rounded niuu-text-status-amber niuu-font-sans niuu-text-xs niuu-py-1 niuu-px-2.5 niuu-cursor-pointer niuu-whitespace-nowrap hover:niuu-bg-status-amber/10 niuu-transition-colors niuu-flex niuu-items-center niuu-gap-1"
            data-testid="btn-dispatch"
          >
            <span>⚡</span> Dispatch
          </button>
        </div>

        {/* Canvas content */}
        <div className="niuu-flex-1 niuu-flex niuu-flex-col niuu-relative niuu-min-h-0">
          {view === 'graph' && (
            <GraphView
              nodes={workflow.nodes}
              edges={workflow.edges}
              selectedNodeId={selectedNodeId}
              connectingFromId={connectingFromId}
              onSelectNode={selectNode}
              onInspectNode={inspectNode}
              onAddNode={addNode}
              onDeleteNode={deleteNode}
              onMoveNode={moveNode}
              onStartConnect={startConnect}
              onCancelConnect={cancelConnect}
              onCompleteConnect={completeConnect}
            />
          )}
          {view === 'pipeline' && (
            <PipelineView
              nodes={workflow.nodes}
              edges={workflow.edges}
              selectedNodeId={selectedNodeId}
              onSelectNode={selectNode}
            />
          )}
          {view === 'yaml' && <YamlView workflow={workflow} />}

          {/* ValidationPanel overlays the canvas */}
          <ValidationPanel
            workflow={workflow}
            onSelectNode={selectNode}
            errorCount={errorCount}
            warnCount={warnCount}
          />
        </div>
      </div>

      {/* Detail panel — right side */}
      <WorkflowDetailPanel
        workflow={workflow}
        errorCount={errorCount}
        warnCount={warnCount}
      />

      {/* Node Inspector dialog */}
      {inspectorNode && (
        <NodeInspector
          node={inspectorNode}
          onClose={() => inspectNode(null)}
          onUpdateLabel={updateNodeLabel}
          onRemovePersona={removePersonaFromStage}
        />
      )}
    </div>
  );
}
