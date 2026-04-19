import { useMemo } from 'react';
import { usePersonas } from './usePersonas';
import { usePersona } from './usePersona';

// ── Layout constants ───────────────────────────────────────────────────────

const COL_W = 160;
const NODE_H = 32;
const NODE_GAP = 12;
const COL_GAP = 120;
const PAD_H = 40;
const PAD_V = 40;

// ── Types ──────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  col: number; // 0 = producers, 1 = focus, 2 = consumers
  row: number;
}

interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function nodeX(col: number): number {
  return PAD_H + col * (COL_W + COL_GAP);
}

function nodeY(row: number): number {
  return PAD_V + row * (NODE_H + NODE_GAP);
}

function nodeCx(col: number): number {
  return nodeX(col) + COL_W / 2;
}

function nodeCy(row: number): number {
  return nodeY(row) + NODE_H / 2;
}

// ── Component ─────────────────────────────────────────────────────────────

export interface PersonaSubsProps {
  name: string;
}

/**
 * PersonaSubs — subscription graph for a persona.
 *
 * Layout: producers (col 0) → this persona (col 1) → consumers (col 2).
 * Each edge is labelled with the event name that connects the nodes.
 */
export function PersonaSubs({ name }: PersonaSubsProps) {
  const { data: allPersonas } = usePersonas();
  const { data: persona, isLoading, isError, error } = usePersona(name);

  const graph = useMemo<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(() => {
    if (!persona || !allPersonas) return null;

    const consumedEventNames = persona.consumes.events.map((e) => e.name);
    const producedEvent = persona.produces.eventType;

    // Producers: personas whose producesEvent is consumed by this persona
    const producers = allPersonas.filter(
      (p) => p.name !== name && consumedEventNames.includes(p.producesEvent),
    );

    // Consumers: personas that consume this persona's event
    const consumers = allPersonas.filter(
      (p) => p.name !== name && producedEvent && p.consumesEvents.includes(producedEvent),
    );

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Col 0: producers
    producers.forEach((p, i) => {
      nodes.push({ id: p.name, label: p.name, col: 0, row: i });
      edges.push({ from: p.name, to: name, label: p.producesEvent });
    });

    // Col 1: focus persona
    const focusRow = Math.max(
      0,
      Math.floor((Math.max(producers.length, consumers.length) - 1) / 2),
    );
    nodes.push({ id: name, label: name, col: 1, row: focusRow });

    // Col 2: consumers
    consumers.forEach((p, i) => {
      nodes.push({ id: `consumer-${p.name}`, label: p.name, col: 2, row: i });
      edges.push({ from: name, to: `consumer-${p.name}`, label: producedEvent });
    });

    return { nodes, edges };
  }, [persona, allPersonas, name]);

  if (isLoading) {
    return (
      <div
        data-testid="persona-subs-loading"
        className="niuu-p-6 niuu-text-sm niuu-text-text-muted"
      >
        Loading subscription graph…
      </div>
    );
  }

  if (isError) {
    return (
      <div data-testid="persona-subs-error" className="niuu-p-6 niuu-text-sm niuu-text-critical">
        {error instanceof Error ? error.message : 'Failed to load persona'}
      </div>
    );
  }

  if (!graph) return null;

  const { nodes, edges } = graph;

  if (nodes.length === 1) {
    // Only the focus persona — no connections
    return (
      <div
        data-testid="persona-subs-empty"
        className="niuu-flex niuu-items-center niuu-justify-center niuu-h-full niuu-p-6 niuu-text-sm niuu-text-text-muted"
      >
        No event subscriptions — this persona neither consumes nor produces events connected to
        others.
      </div>
    );
  }

  const maxRow = Math.max(...nodes.map((n) => n.row));
  const svgW = nodeX(2) + COL_W + PAD_H;
  const svgH = nodeY(maxRow) + NODE_H + PAD_V;

  return (
    <div data-testid="persona-subs" className="niuu-overflow-auto niuu-h-full niuu-p-4">
      <svg
        width={svgW}
        height={svgH}
        role="img"
        aria-label={`Event subscription graph for ${name}`}
        className="niuu-block"
      >
        <title>Event subscription graph for {name}</title>

        {/* Edges */}
        {edges.map((edge) => {
          const fromNode = nodes.find((n) => n.id === edge.from);
          const toNode = nodes.find((n) => n.id === edge.to);
          if (!fromNode || !toNode) return null;

          const x1 = nodeX(fromNode.col) + COL_W;
          const y1 = nodeCy(fromNode.row);
          const x2 = nodeX(toNode.col);
          const y2 = nodeCy(toNode.row);
          const mx = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          return (
            <g key={`${edge.from}-${edge.to}`}>
              <path
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                fill="none"
                stroke="var(--color-border)"
                strokeWidth={1.5}
              />
              <text
                x={mx}
                y={midY - 4}
                textAnchor="middle"
                fontSize={9}
                fontFamily="var(--font-mono)"
                fill="var(--color-text-muted)"
              >
                {edge.label}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const x = nodeX(node.col);
          const y = nodeY(node.row);
          const isFocus = node.id === name;

          return (
            <g key={node.id}>
              <rect
                x={x}
                y={y}
                width={COL_W}
                height={NODE_H}
                rx={4}
                fill={
                  isFocus
                    ? 'color-mix(in srgb, var(--brand-500) 18%, transparent)'
                    : 'var(--color-bg-secondary)'
                }
                stroke={isFocus ? 'var(--brand-400)' : 'var(--color-border)'}
                strokeWidth={isFocus ? 1.5 : 1}
              />
              <text
                x={nodeCx(node.col)}
                y={nodeCy(node.row) + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fontFamily="var(--font-sans)"
                fill={isFocus ? 'var(--brand-300)' : 'var(--color-text-secondary)'}
                fontWeight={isFocus ? 600 : 400}
              >
                {node.label.length > 16 ? `${node.label.slice(0, 14)}…` : node.label}
              </text>
            </g>
          );
        })}

        {/* Column headers */}
        {[
          { col: 0, label: 'Producers' },
          { col: 1, label: 'This persona' },
          { col: 2, label: 'Consumers' },
        ].map(({ col, label }) => (
          <text
            key={col}
            x={nodeCx(col)}
            y={14}
            textAnchor="middle"
            fontSize={10}
            fontFamily="var(--font-mono)"
            fill="var(--color-text-muted)"
            style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
          >
            {label}
          </text>
        ))}
      </svg>
    </div>
  );
}
