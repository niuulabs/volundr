import { StateDot, Chip } from '@niuulabs/ui';
import { useGraph } from '../application/useGraph';
import type { MimirGraph, GraphNode } from '../domain/api-types';
import './GraphPage.css';

const MAX_HOPS = 4;
const MIN_HOPS = 1;

// ---------------------------------------------------------------------------
// Simple circular SVG layout
// ---------------------------------------------------------------------------

interface NodePosition {
  node: GraphNode;
  x: number;
  y: number;
}

function layoutCircle(nodes: GraphNode[], cx = 300, cy = 220, r = 170): NodePosition[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [{ node: nodes[0]!, x: cx, y: cy }];

  return nodes.map((node, i) => {
    const angle = (i / nodes.length) * 2 * Math.PI - Math.PI / 2;
    return {
      node,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });
}

interface GraphSvgProps {
  graph: MimirGraph;
  focusId: string | null;
  onNodeClick: (id: string) => void;
}

function GraphSvg({ graph, focusId, onNodeClick }: GraphSvgProps) {
  const positions = layoutCircle(graph.nodes);
  const posMap = new Map(positions.map((p) => [p.node.id, p]));

  return (
    <svg
      className="graph-page__svg"
      viewBox="0 0 600 440"
      role="img"
      aria-label="Knowledge graph"
    >
      <g className="graph-page__edges">
        {graph.edges.map((edge) => {
          const src = posMap.get(edge.source);
          const tgt = posMap.get(edge.target);
          if (!src || !tgt) return null;
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              x1={src.x}
              y1={src.y}
              x2={tgt.x}
              y2={tgt.y}
              className="graph-page__edge"
            />
          );
        })}
      </g>
      <g className="graph-page__nodes">
        {positions.map(({ node, x, y }) => {
          const isFocus = node.id === focusId;
          return (
            <g
              key={node.id}
              transform={`translate(${x},${y})`}
              onClick={() => onNodeClick(node.id)}
              className={[
                'graph-page__node',
                isFocus ? 'graph-page__node--focus' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              role="button"
              aria-pressed={isFocus}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onNodeClick(node.id);
              }}
            >
              <circle r={isFocus ? 14 : 10} className="graph-page__node-circle" />
              <text dy={isFocus ? 26 : 22} className="graph-page__node-label">
                {node.title.length > 20 ? `${node.title.slice(0, 18)}…` : node.title}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// GraphPage
// ---------------------------------------------------------------------------

export function GraphPage() {
  const { focusedGraph, graph, focusId, hops, setFocusId, setHops, isLoading, isError, error } =
    useGraph();

  const displayGraph = focusedGraph ?? graph;

  return (
    <div className="graph-page">
      <h2 className="graph-page__title">Knowledge Graph</h2>

      <div className="graph-page__toolbar">
        <div className="graph-page__focus-controls">
          <label htmlFor="graph-focus-input" className="graph-page__label">
            Focus node
          </label>
          <input
            id="graph-focus-input"
            className="graph-page__focus-input"
            type="text"
            placeholder="Page path or ID…"
            value={focusId ?? ''}
            onChange={(e) => setFocusId(e.target.value || null)}
            aria-label="Focus node ID"
          />
          {focusId && (
            <button
              className="graph-page__clear-btn"
              onClick={() => setFocusId(null)}
              aria-label="Clear focus"
            >
              clear
            </button>
          )}
        </div>

        <div className="graph-page__hop-controls">
          <label className="graph-page__label">Hops</label>
          <div className="graph-page__hop-btns" role="group" aria-label="Hop count">
            {Array.from({ length: MAX_HOPS - MIN_HOPS + 1 }, (_, i) => i + MIN_HOPS).map((h) => (
              <button
                key={h}
                className={[
                  'graph-page__hop-btn',
                  h === hops ? 'graph-page__hop-btn--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setHops(h)}
                aria-pressed={h === hops}
                data-hops={h}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="graph-page__status">
          <StateDot state="processing" pulse />
          <span>loading graph…</span>
        </div>
      )}

      {isError && (
        <div className="graph-page__status">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'graph load failed'}</span>
        </div>
      )}

      {displayGraph && (
        <>
          <div className="graph-page__stats">
            <Chip tone="muted">{displayGraph.nodes.length} nodes</Chip>
            <Chip tone="muted">{displayGraph.edges.length} edges</Chip>
            {focusId && (
              <Chip tone="default">
                {hops}-hop focus: {focusId}
              </Chip>
            )}
          </div>

          <GraphSvg
            graph={displayGraph}
            focusId={focusId}
            onNodeClick={(id) => setFocusId(focusId === id ? null : id)}
          />
        </>
      )}
    </div>
  );
}
