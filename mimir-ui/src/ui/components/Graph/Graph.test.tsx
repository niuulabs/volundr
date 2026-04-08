import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Graph } from './Graph';
import type { GraphNode, GraphEdge } from '@/domain';

const nodes: GraphNode[] = [
  { id: 'technical/ravn/architecture.md', title: 'Ravn Architecture', category: 'technical', inboundCount: 1 },
  { id: 'technical/ravn/cascade.md', title: 'Cascade Protocol', category: 'technical', inboundCount: 0 },
  { id: 'projects/niuu/roadmap.md', title: 'Niuu Roadmap', category: 'projects', inboundCount: 0 },
];

const edges: GraphEdge[] = [
  { source: 'technical/ravn/architecture.md', target: 'technical/ravn/cascade.md' },
];

describe('Graph', () => {
  it('renders an SVG element', () => {
    const { container } = render(
      <Graph
        nodes={nodes}
        edges={edges}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
        searchQuery=""
        categoryFilter={null}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders without crashing with empty nodes and edges', () => {
    const { container } = render(
      <Graph
        nodes={[]}
        edges={[]}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
        searchQuery=""
        categoryFilter={null}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders with categoryFilter applied', () => {
    const { container } = render(
      <Graph
        nodes={nodes}
        edges={edges}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
        searchQuery=""
        categoryFilter="technical"
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders with a selectedNodeId', () => {
    const { container } = render(
      <Graph
        nodes={nodes}
        edges={edges}
        selectedNodeId="technical/ravn/architecture.md"
        onNodeClick={vi.fn()}
        searchQuery=""
        categoryFilter={null}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders with a search query', () => {
    const { container } = render(
      <Graph
        nodes={nodes}
        edges={edges}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
        searchQuery="ravn"
        categoryFilter={null}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders with nodes that have no inboundCount defined', () => {
    const nodesWithoutCount: GraphNode[] = [
      { id: 'a.md', title: 'A Page', category: 'technical' },
    ];
    const { container } = render(
      <Graph
        nodes={nodesWithoutCount}
        edges={[]}
        selectedNodeId={null}
        onNodeClick={vi.fn()}
        searchQuery=""
        categoryFilter={null}
      />,
    );
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
