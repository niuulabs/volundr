/**
 * PipelineView — read-only vertical topological layout of the workflow.
 *
 * Uses `topologicalSort()` to assign each node a depth layer.
 * Nodes are displayed in horizontal rows by depth with connecting lines.
 *
 * Owner: plugin-tyr (WorkflowBuilder).
 */

import type { WorkflowNode, WorkflowEdge } from '../../domain/workflow';
import { topologicalSort } from '../../domain/topologicalSort';

export interface PipelineViewProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId?: string | null;
  onSelectNode?: (id: string) => void;
}

const KIND_LABEL: Record<WorkflowNode['kind'], string> = {
  stage: 'Stage',
  gate: 'Gate',
  cond: 'Cond',
};

const KIND_BADGE_COLOR: Record<WorkflowNode['kind'], string> = {
  stage: 'var(--color-brand)',
  gate: 'var(--color-accent-amber)',
  cond: 'var(--color-accent-cyan)',
};

export function PipelineView({ nodes, edges, selectedNodeId, onSelectNode }: PipelineViewProps) {
  const layers = topologicalSort(
    nodes.map((n) => n.id),
    edges,
  );

  const nodeById = new Map<string, WorkflowNode>(nodes.map((n) => [n.id, n]));

  // Nodes excluded from topological layers (part of a cycle)
  const layerNodeIds = new Set(layers.flatMap((l) => l.nodeIds));
  const cycleNodes = nodes.filter((n) => !layerNodeIds.has(n.id));

  if (nodes.length === 0) {
    return (
      <div
        data-testid="pipeline-view"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-muted)',
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
        }}
      >
        No nodes — add stages in the Graph view.
      </div>
    );
  }

  return (
    <div
      data-testid="pipeline-view"
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: 24,
        fontFamily: 'var(--font-sans)',
        background: 'var(--color-bg-primary)',
      }}
    >
      {layers.map((layer, layerIdx) => (
        <div key={layer.depth}>
          {/* Layer label */}
          <div
            style={{
              fontSize: 10,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 6,
            }}
          >
            Layer {layer.depth}
          </div>

          {/* Nodes in this layer */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {layer.nodeIds.map((id) => {
              const node = nodeById.get(id);
              if (!node) return null;
              const isSelected = node.id === selectedNodeId;
              return (
                <button
                  key={id}
                  data-testid={`pipeline-node-${id}`}
                  data-selected={isSelected ? 'true' : undefined}
                  onClick={() => onSelectNode?.(id)}
                  style={{
                    background: isSelected
                      ? 'var(--color-bg-elevated)'
                      : 'var(--color-bg-secondary)',
                    border: `1px solid ${isSelected ? 'var(--color-brand)' : 'var(--color-border)'}`,
                    borderRadius: 6,
                    padding: '8px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 2,
                    minWidth: 120,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      color: KIND_BADGE_COLOR[node.kind],
                    }}
                  >
                    {KIND_LABEL[node.kind]}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      color: 'var(--color-text-primary)',
                      fontWeight: 500,
                    }}
                  >
                    {node.label}
                  </span>
                  {node.kind === 'stage' && node.personaIds.length > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                      {node.personaIds.length} persona{node.personaIds.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Connector arrow between layers */}
          {layerIdx < layers.length - 1 && (
            <div
              style={{
                marginLeft: 16,
                marginBottom: 8,
                color: 'var(--color-border)',
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              ↓
            </div>
          )}
        </div>
      ))}

      {/* Cycle nodes (excluded from topological sort) */}
      {cycleNodes.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              fontSize: 10,
              color: 'var(--color-critical)',
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 6,
            }}
          >
            ⚠ Cycle nodes (excluded)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {cycleNodes.map((node) => (
              <button
                key={node.id}
                data-testid={`pipeline-node-${node.id}`}
                onClick={() => onSelectNode?.(node.id)}
                style={{
                  background: 'var(--color-critical-bg)',
                  border: '1px solid var(--color-critical)',
                  borderRadius: 6,
                  padding: '8px 14px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  color: 'var(--color-critical-fg)',
                  fontSize: 13,
                }}
              >
                {node.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
