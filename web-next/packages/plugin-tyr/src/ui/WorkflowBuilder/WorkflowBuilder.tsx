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
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 600,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 0,
          padding: '8px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
          flexShrink: 0,
        }}
      >
        <h3
          style={{
            margin: 0,
            marginRight: 20,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
          }}
        >
          {workflow.name}
        </h3>

        {/* View tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          {VIEWS.map((v) => (
            <button
              key={v}
              data-testid={`tab-${v}`}
              data-active={view === v ? 'true' : undefined}
              onClick={() => setView(v)}
              style={{
                background: view === v ? 'var(--color-bg-elevated)' : 'transparent',
                border: `1px solid ${view === v ? 'var(--color-border)' : 'transparent'}`,
                borderRadius: 4,
                padding: '4px 12px',
                fontSize: 12,
                color: view === v ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
              }}
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
            style={{
              marginLeft: 'auto',
              background: 'var(--color-brand)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              padding: '4px 14px',
              fontSize: 12,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            Save
          </button>
        )}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
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
