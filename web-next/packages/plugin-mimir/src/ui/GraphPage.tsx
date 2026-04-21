import { StateDot, Chip } from '@niuulabs/ui';
import { useGraph } from '../application/useGraph';
import type { MimirGraph, GraphNode } from '../domain/api-types';
import './GraphPage.css';

const MAX_HOPS = 4;
const MIN_HOPS = 1;
const SVG_CX = 300;
const SVG_CY = 220;
const SVG_R = 170;

// Category color palette (maps to CSS tokens in order)
const CATEGORY_COLORS = [
  'var(--color-accent-cyan)',
  'var(--color-accent-indigo)',
  'var(--color-accent-emerald)',
  'var(--color-accent-purple)',
  'var(--color-accent-amber)',
  'var(--color-accent-orange)',
  'var(--color-accent-red)',
  'var(--color-text-secondary)',
] as const;

function getCategoryIndex(category: string, categories: string[]): number {
  const idx = categories.indexOf(category);
  return (idx < 0 ? 0 : idx) % CATEGORY_COLORS.length;
}

function getCategoryFill(category: string, categories: string[]): string {
  return CATEGORY_COLORS[getCategoryIndex(category, categories)] ?? CATEGORY_COLORS[0];
}

// ---------------------------------------------------------------------------
// SVG layout
// ---------------------------------------------------------------------------

interface NodePosition {
  node: GraphNode;
  x: number;
  y: number;
}

/**
 * Category-radial layout: groups nodes by category into radial sectors.
 * Each category occupies a sector proportional to its node count. Within
 * each sector, nodes are offset with sine-based jitter (seeded by index)
 * for a visually organic, deterministic layout matching the web2 prototype.
 */
export function layoutCategoryRadial(
  nodes: GraphNode[],
  cx = SVG_CX,
  cy = SVG_CY,
  r = SVG_R,
): NodePosition[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [{ node: nodes[0]!, x: cx, y: cy }];

  const categories = [...new Set(nodes.map((n) => n.category))];
  const byCategory = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = byCategory.get(node.category) ?? [];
    list.push(node);
    byCategory.set(node.category, list);
  }

  const result: NodePosition[] = [];
  let sectorStart = -Math.PI / 2; // start from top of circle

  for (const cat of categories) {
    const catNodes = byCategory.get(cat) ?? [];
    const sectorSize = (catNodes.length / nodes.length) * 2 * Math.PI;
    const sectorCenter = sectorStart + sectorSize / 2;

    for (let i = 0; i < catNodes.length; i++) {
      const node = catNodes[i]!;
      const spread = catNodes.length <= 1 ? 0 : 0.8;
      const innerAngle = catNodes.length <= 1 ? 0 : (i / catNodes.length) * spread - spread / 2;
      const jitter = 0.5 + 0.5 * (Math.abs(Math.sin(i * 2.1)) * 0.9 + 0.1);
      const radius = r * jitter;
      result.push({
        node,
        x: cx + radius * Math.cos(sectorCenter + innerAngle),
        y: cy + radius * Math.sin(sectorCenter + innerAngle),
      });
    }

    sectorStart += sectorSize;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Graph SVG
// ---------------------------------------------------------------------------

interface GraphSvgProps {
  graph: MimirGraph;
  focusId: string | null;
  onNodeClick: (id: string) => void;
  categories: string[];
}

function GraphSvg({ graph, focusId, onNodeClick, categories }: GraphSvgProps) {
  const positions = layoutCategoryRadial(graph.nodes);
  const posMap = new Map(positions.map((p) => [p.node.id, p]));

  return (
    <svg
      className="niuu-w-full niuu-max-w-[600px] niuu-h-auto niuu-border niuu-border-border-subtle niuu-rounded-lg niuu-bg-bg-secondary niuu-block"
      viewBox="0 0 600 440"
      role="img"
      aria-label="Knowledge graph"
    >
      <defs>
        <filter id="niuu-node-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g>
        {graph.edges.map((edge) => {
          const src = posMap.get(edge.source);
          const tgt = posMap.get(edge.target);
          if (!src || !tgt) return null;
          const isFocusEdge =
            focusId !== null && (edge.source === focusId || edge.target === focusId);
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              x1={src.x}
              y1={src.y}
              x2={tgt.x}
              y2={tgt.y}
              stroke="var(--color-border)"
              strokeWidth={1.5}
              className={isFocusEdge ? 'niuu-opacity-50' : 'niuu-opacity-15'}
            />
          );
        })}
      </g>

      <g>
        {positions.map(({ node, x, y }) => {
          const isFocus = node.id === focusId;
          const fill = isFocus
            ? 'var(--color-brand, var(--color-accent-cyan))'
            : getCategoryFill(node.category, categories);
          return (
            <g
              key={node.id}
              transform={`translate(${x},${y})`}
              onClick={() => onNodeClick(node.id)}
              className="niuu-graph-node niuu-cursor-pointer"
              role="button"
              aria-pressed={isFocus}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onNodeClick(node.id);
              }}
            >
              <circle
                r={isFocus ? 14 : 10}
                className="niuu-graph-node-circle"
                fill={fill}
                stroke={isFocus ? fill : 'var(--color-border)'}
                strokeWidth={1.5}
              />
              <text
                dy={isFocus ? 26 : 22}
                textAnchor="middle"
                fill="var(--color-text-secondary)"
                className="niuu-text-xs niuu-font-sans niuu-pointer-events-none"
              >
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
// Legend
// ---------------------------------------------------------------------------

interface LegendProps {
  categories: string[];
}

function GraphLegend({ categories }: LegendProps) {
  if (categories.length === 0) return null;
  return (
    <div
      className="niuu-flex niuu-flex-col niuu-gap-2 niuu-px-4 niuu-py-3 niuu-bg-bg-secondary niuu-border niuu-border-border-subtle niuu-rounded-lg niuu-min-w-[140px]"
      aria-label="Graph legend"
    >
      <span className="niuu-text-[10px] niuu-uppercase niuu-tracking-widest niuu-text-text-muted niuu-pb-1 niuu-border-b niuu-border-border-subtle">
        Categories
      </span>
      {categories.map((cat, i) => (
        <div key={cat} className="niuu-flex niuu-items-center niuu-gap-2">
          <span
            className="niuu-graph-legend-dot niuu-w-2.5 niuu-h-2.5 niuu-rounded-full niuu-shrink-0"
            data-color-idx={String(i % CATEGORY_COLORS.length)}
            aria-hidden
          />
          <span className="niuu-text-xs niuu-text-text-secondary niuu-whitespace-nowrap niuu-overflow-hidden niuu-text-ellipsis">
            {cat}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GraphPage
// ---------------------------------------------------------------------------

export function GraphPage() {
  const { focusedGraph, graph, focusId, hops, setFocusId, setHops, isLoading, isError, error } =
    useGraph();

  const displayGraph = focusedGraph ?? graph;
  const categories = displayGraph
    ? [...new Set(displayGraph.nodes.map((n) => n.category))].filter(Boolean).sort()
    : [];

  return (
    <div className="niuu-p-6 niuu-max-w-4xl">
      <h2 className="niuu-m-0 niuu-mb-5 niuu-text-2xl niuu-font-semibold niuu-text-text-primary">
        Knowledge Graph
      </h2>

      <div className="niuu-flex niuu-flex-wrap niuu-gap-4 niuu-mb-4 niuu-items-end">
        <div className="niuu-flex niuu-flex-col niuu-flex-1 niuu-min-w-[220px]">
          <label
            htmlFor="graph-focus-input"
            className="niuu-block niuu-text-text-muted niuu-text-xs niuu-mb-1"
          >
            Focus node
          </label>
          <input
            id="graph-focus-input"
            className="niuu-px-3 niuu-py-2 niuu-bg-bg-secondary niuu-border niuu-border-border niuu-rounded-md niuu-text-text-primary niuu-font-mono niuu-text-xs niuu-outline-none focus:niuu-border-brand"
            type="text"
            placeholder="Page path or ID…"
            value={focusId ?? ''}
            onChange={(e) => setFocusId(e.target.value || null)}
            aria-label="Focus node ID"
          />
          {focusId && (
            <button
              className="niuu-mt-1 niuu-self-start niuu-bg-transparent niuu-border-0 niuu-text-text-muted niuu-text-xs niuu-cursor-pointer niuu-p-0 hover:niuu-text-text-secondary"
              onClick={() => setFocusId(null)}
              aria-label="Clear focus"
            >
              clear
            </button>
          )}
        </div>

        <div className="niuu-flex niuu-flex-col">
          <label className="niuu-block niuu-text-text-muted niuu-text-xs niuu-mb-1">Hops</label>
          <div className="niuu-flex niuu-gap-1" role="group" aria-label="Hop count">
            {Array.from({ length: MAX_HOPS - MIN_HOPS + 1 }, (_, i) => i + MIN_HOPS).map((h) => (
              <button
                key={h}
                className={[
                  'niuu-w-8 niuu-h-7 niuu-border niuu-rounded-sm niuu-text-xs niuu-cursor-pointer',
                  h === hops
                    ? 'niuu-bg-brand niuu-border-brand niuu-text-bg-primary niuu-font-semibold'
                    : 'niuu-bg-bg-secondary niuu-border-border-subtle niuu-text-text-secondary',
                ].join(' ')}
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
        <div className="niuu-flex niuu-items-center niuu-gap-2">
          <StateDot state="processing" pulse />
          <span>loading graph…</span>
        </div>
      )}

      {isError && (
        <div className="niuu-flex niuu-items-center niuu-gap-2">
          <StateDot state="failed" />
          <span>{error instanceof Error ? error.message : 'graph load failed'}</span>
        </div>
      )}

      {displayGraph && (
        <>
          <div className="niuu-flex niuu-gap-2 niuu-mb-4 niuu-flex-wrap">
            <Chip tone="muted">{displayGraph.nodes.length} nodes</Chip>
            <Chip tone="muted">{displayGraph.edges.length} edges</Chip>
            {focusId && (
              <Chip tone="default">
                {hops}-hop focus: {focusId}
              </Chip>
            )}
          </div>

          <div className="niuu-flex niuu-gap-4 niuu-items-start niuu-flex-wrap">
            <GraphSvg
              graph={displayGraph}
              focusId={focusId}
              onNodeClick={(id) => setFocusId(focusId === id ? null : id)}
              categories={categories}
            />
            <GraphLegend categories={categories} />
          </div>
        </>
      )}
    </div>
  );
}
