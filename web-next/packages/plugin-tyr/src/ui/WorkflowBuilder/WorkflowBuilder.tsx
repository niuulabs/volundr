/**
 * WorkflowBuilder — three-view DAG editor for Tyr Workflows.
 *
 * Views:
 *  • Graph   — pan/zoom SVG canvas with node/edge editing
 *  • Pipeline — read-only topological layout
 *  • YAML    — read-only pretty-printed YAML
 *
 * The floating ValidationPanel shows live semantic issues and lets users
 * click-to-select the offending node.
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import { cn } from '@niuulabs/ui';
import type { Workflow } from '../../domain/workflow';
import { useWorkflowBuilder, type WorkflowView } from './useWorkflowBuilder';
import { GraphView } from './GraphView';
import { PipelineView } from './PipelineView';
import { YamlView } from './YamlView';
import { ValidationPanel } from './ValidationPanel';
import { NodeInspector } from './NodeInspector';
import { LibraryPanel, DEFAULT_PERSONAS, type PersonaEntry } from './LibraryPanel';

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

  const inspectorNode = inspectorNodeId
    ? (workflow.nodes.find((n) => n.id === inspectorNodeId) ?? null)
    : null;

  function handleSave() {
    onSave?.(workflow);
  }

  return (
    <div
      data-testid="workflow-builder"
      className="niuu-flex niuu-flex-col niuu-h-full niuu-min-h-[600px] niuu-font-sans"
    >
      {/* Header bar */}
      <div className="niuu-flex niuu-items-center niuu-py-2 niuu-px-4 niuu-border-b niuu-border-border niuu-bg-bg-secondary niuu-shrink-0">
        <h3 className="niuu-m-0 niuu-mr-5 niuu-text-sm niuu-font-semibold niuu-text-text-primary">
          {workflow.name}
        </h3>

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
                  ? 'niuu-bg-bg-elevated niuu-border-border niuu-text-text-primary'
                  : 'niuu-bg-transparent niuu-border-transparent niuu-text-text-muted',
              )}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>

        {/* Save button */}
        {onSave && (
          <button
            data-testid="save-workflow"
            onClick={handleSave}
            className="niuu-ml-auto niuu-bg-brand niuu-text-white niuu-border-none niuu-rounded niuu-px-3.5 niuu-py-1 niuu-text-xs niuu-cursor-pointer niuu-font-sans"
          >
            Save
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="niuu-flex-1 niuu-flex niuu-min-h-0 niuu-relative">
        {view === 'graph' && (
          <>
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
            <LibraryPanel personas={personas ?? DEFAULT_PERSONAS} />
          </>
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

        {/* ValidationPanel overlays the content */}
        <ValidationPanel workflow={workflow} onSelectNode={selectNode} />
      </div>

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
