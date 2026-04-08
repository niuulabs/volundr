import { useRef, useEffect, useCallback } from 'react';
import * as d3 from 'd3';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3';
import type { GraphNode, GraphEdge } from '@/domain';
import styles from './Graph.module.css';

export interface GraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  onNodeClick: (nodeId: string) => void;
  searchQuery: string;
  categoryFilter: string | null;
}

// D3 needs concrete hex values — CSS vars are not available in SVG attr calls
const CATEGORY_COLORS: Record<string, string> = {
  technical: '#6366f1',
  projects: '#10b981',
};
const COLOR_DEFAULT = '#71717a';
const COLOR_SELECTED_RING = '#f59e0b';
const COLOR_DIM = '#3f3f46';

const MIN_RADIUS = 6;
const MAX_RADIUS = 20;
const RADIUS_PER_INBOUND = 2;

interface SimNode extends SimulationNodeDatum {
  id: string;
  title: string;
  category: string;
  inboundCount: number;
}

type SimLink = SimulationLinkDatum<SimNode> & {
  sourceId: string;
  targetId: string;
};

function nodeRadius(inboundCount: number): number {
  return Math.min(MIN_RADIUS + inboundCount * RADIUS_PER_INBOUND, MAX_RADIUS);
}

function nodeColor(category: string): string {
  return CATEGORY_COLORS[category] ?? COLOR_DEFAULT;
}

export function Graph({
  nodes,
  edges,
  selectedNodeId,
  onNodeClick,
  searchQuery,
  categoryFilter,
}: GraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      onNodeClick(nodeId);
    },
    [onNodeClick],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // Clean up previous simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
      simulationRef.current = null;
    }

    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;

    // Build inbound count map
    const inboundMap = new Map<string, number>();
    for (const edge of edges) {
      inboundMap.set(edge.target, (inboundMap.get(edge.target) ?? 0) + 1);
    }

    // Filter nodes by category
    const visibleNodeIds = new Set(
      nodes
        .filter((n) => categoryFilter === null || n.category === categoryFilter)
        .map((n) => n.id),
    );

    const simNodes: SimNode[] = nodes
      .filter((n) => visibleNodeIds.has(n.id))
      .map((n) => ({
        id: n.id,
        title: n.title,
        category: n.category,
        inboundCount: inboundMap.get(n.id) ?? 0,
      }));

    const nodeIdSet = new Set(simNodes.map((n) => n.id));

    const simLinks: SimLink[] = edges
      .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        sourceId: e.source,
        targetId: e.target,
      }));

    // Build adjacency for hover
    const adjacency = new Map<string, Set<string>>();
    for (const link of simLinks) {
      const srcId = typeof link.source === 'string' ? link.source : (link.source as SimNode).id;
      const tgtId = typeof link.target === 'string' ? link.target : (link.target as SimNode).id;
      if (!adjacency.has(srcId)) adjacency.set(srcId, new Set());
      if (!adjacency.has(tgtId)) adjacency.set(tgtId, new Set());
      adjacency.get(srcId)!.add(tgtId);
      adjacency.get(tgtId)!.add(srcId);
    }

    const normalizedSearch = searchQuery.trim().toLowerCase();

    // Clear previous SVG content
    d3.select(svg).selectAll('*').remove();

    const root = d3
      .select(svg)
      .attr('width', width)
      .attr('height', height);

    // Zoom/pan layer
    const zoomGroup = root.append('g').attr('class', 'zoom-layer');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        zoomGroup.attr('transform', event.transform);
      });

    root.call(zoom);

    // Arrow marker for directed edges
    root
      .append('defs')
      .append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -4 8 8')
      .attr('refX', 14)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', COLOR_DIM);

    // Links
    const linkGroup = zoomGroup.append('g').attr('class', 'links');
    const linkSel = linkGroup
      .selectAll<SVGLineElement, SimLink>('line')
      .data(simLinks)
      .enter()
      .append('line')
      .attr('stroke', COLOR_DIM)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.6)
      .attr('marker-end', 'url(#arrowhead)');

    // Node groups
    const nodeGroup = zoomGroup.append('g').attr('class', 'nodes');
    const nodeSel = nodeGroup
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, (d) => d.id)
      .enter()
      .append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer');

    // Selected ring (rendered behind circle)
    nodeSel
      .append('circle')
      .attr('class', 'ring')
      .attr('r', (d) => nodeRadius(d.inboundCount) + 4)
      .attr('fill', 'none')
      .attr('stroke', COLOR_SELECTED_RING)
      .attr('stroke-width', 2.5)
      .attr('opacity', (d) => (d.id === selectedNodeId ? 1 : 0));

    // Main circle
    nodeSel
      .append('circle')
      .attr('class', 'body')
      .attr('r', (d) => nodeRadius(d.inboundCount))
      .attr('fill', (d) => nodeColor(d.category))
      .attr('stroke', '#1c1c1f')
      .attr('stroke-width', 1.5);

    // Label
    nodeSel
      .append('text')
      .attr('dy', (d) => nodeRadius(d.inboundCount) + 12)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('font-family', 'var(--font-sans, system-ui, sans-serif)')
      .attr('fill', '#a1a1aa')
      .attr('pointer-events', 'none')
      .text((d) => (d.title.length > 20 ? d.title.slice(0, 18) + '…' : d.title));

    // Apply search highlighting
    function applySearch() {
      if (!normalizedSearch) {
        nodeSel.select<SVGCircleElement>('circle.body').attr('opacity', 1);
        nodeSel.select<SVGTextElement>('text').attr('opacity', 0.7);
        return;
      }
      nodeSel.each(function (d) {
        const matches = d.title.toLowerCase().includes(normalizedSearch);
        d3.select(this)
          .select<SVGCircleElement>('circle.body')
          .attr('opacity', matches ? 1 : 0.2);
        d3.select(this)
          .select<SVGTextElement>('text')
          .attr('opacity', matches ? 1 : 0.1);
      });
    }

    applySearch();

    // Hover interaction
    nodeSel
      .on('mouseenter', function (_event, d) {
        const connected = adjacency.get(d.id) ?? new Set<string>();
        nodeSel.each(function (n) {
          const isConnected = n.id === d.id || connected.has(n.id);
          d3.select(this)
            .select<SVGCircleElement>('circle.body')
            .attr('opacity', isConnected ? 1 : 0.15);
          d3.select(this)
            .select<SVGTextElement>('text')
            .attr('opacity', isConnected ? 1 : 0.05);
        });
        linkSel.attr('stroke-opacity', (l) => {
          const srcId =
            typeof l.source === 'string' ? l.source : (l.source as SimNode).id;
          const tgtId =
            typeof l.target === 'string' ? l.target : (l.target as SimNode).id;
          return srcId === d.id || tgtId === d.id ? 1 : 0.05;
        });
      })
      .on('mouseleave', function () {
        applySearch();
        linkSel.attr('stroke-opacity', 0.6);
      })
      .on('click', (_event, d) => {
        handleNodeClick(d.id);
      });

    // Drag
    const drag = d3
      .drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeSel.call(drag);

    // Simulation
    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(80)
          .strength(0.5),
      )
      .force('charge', d3.forceManyBody<SimNode>().strength(-200))
      .force('center', d3.forceCenter<SimNode>(width / 2, height / 2))
      .force('collision', d3.forceCollide<SimNode>((d) => nodeRadius(d.inboundCount) + 4));

    simulation.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0);

      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [nodes, edges, categoryFilter, selectedNodeId, searchQuery, handleNodeClick]);

  return (
    <div className={styles.container}>
      <svg ref={svgRef} className={styles.svg} />
    </div>
  );
}
