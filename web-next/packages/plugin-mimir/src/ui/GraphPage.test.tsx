import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { GraphPage, layoutCategoryRadial } from './GraphPage';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';
import { renderWithMimir } from '../testing/renderWithMimir';
import type { GraphNode } from '../domain/api-types';

const wrap = renderWithMimir;

describe('GraphPage', () => {
  it('renders the page title', () => {
    wrap(<GraphPage />);
    expect(screen.getByRole('heading', { name: /knowledge graph/i })).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    wrap(<GraphPage />);
    expect(screen.getByText(/loading graph/)).toBeInTheDocument();
  });

  it('renders graph nodes after load', async () => {
    wrap(<GraphPage />);
    await waitFor(() => expect(screen.getByText(/nodes/)).toBeInTheDocument());
  });

  it('renders the SVG graph canvas', async () => {
    wrap(<GraphPage />);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: /knowledge graph/i })).toBeInTheDocument(),
    );
  });

  it('renders hop selector buttons', () => {
    wrap(<GraphPage />);
    expect(screen.getByRole('group', { name: /hop count/i })).toBeInTheDocument();
  });

  it('hop 2 is active by default', () => {
    wrap(<GraphPage />);
    const hopBtns = screen.getAllByRole('button', { name: /\d/ });
    const hop2Btn = hopBtns.find((b) => b.getAttribute('data-hops') === '2');
    expect(hop2Btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking a hop button updates active state', () => {
    wrap(<GraphPage />);
    const hop1Btn = screen.getByRole('button', { name: '1' });
    fireEvent.click(hop1Btn);
    expect(hop1Btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('entering a focus node shows clear button', async () => {
    wrap(<GraphPage />);
    await waitFor(() => screen.getByRole('img', { name: /knowledge graph/i }));
    const focusInput = screen.getByLabelText(/focus node id/i);
    fireEvent.change(focusInput, { target: { value: '/arch/overview' } });
    expect(screen.getByRole('button', { name: /clear focus/i })).toBeInTheDocument();
  });

  it('clearing focus removes the clear button', async () => {
    wrap(<GraphPage />);
    await waitFor(() => screen.getByRole('img', { name: /knowledge graph/i }));
    const focusInput = screen.getByLabelText(/focus node id/i);
    fireEvent.change(focusInput, { target: { value: '/arch/overview' } });
    fireEvent.click(screen.getByRole('button', { name: /clear focus/i }));
    expect(screen.queryByRole('button', { name: /clear focus/i })).not.toBeInTheDocument();
  });

  it('shows error state when graph load fails', async () => {
    const failing: IMimirService = {
      ...createMimirMockAdapter(),
      pages: {
        ...createMimirMockAdapter().pages,
        getGraph: async () => {
          throw new Error('graph service unavailable');
        },
      },
    };
    wrap(<GraphPage />, failing);
    await waitFor(() => expect(screen.getByText('graph service unavailable')).toBeInTheDocument());
  });

  it('SVG contains glow filter definition', async () => {
    wrap(<GraphPage />);
    await waitFor(() => screen.getByRole('img', { name: /knowledge graph/i }));
    const svg = screen.getByRole('img', { name: /knowledge graph/i });
    expect(svg.querySelector('filter#niuu-node-glow')).toBeInTheDocument();
  });

  it('unfocused edges have low-opacity class', async () => {
    wrap(<GraphPage />);
    await waitFor(() => screen.getByRole('img', { name: /knowledge graph/i }));
    const svg = screen.getByRole('img', { name: /knowledge graph/i });
    const lines = svg.querySelectorAll('line');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]!.classList.toString()).toContain('niuu-opacity-15');
  });

  it('focused-node edges have highlighted opacity class', async () => {
    wrap(<GraphPage />);
    await waitFor(() => screen.getByRole('img', { name: /knowledge graph/i }));
    const focusInput = screen.getByLabelText(/focus node id/i);
    fireEvent.change(focusInput, { target: { value: '/arch/overview' } });
    await waitFor(() => {
      const svg = screen.getByRole('img', { name: /knowledge graph/i });
      const highlightedLines = svg.querySelectorAll('line.niuu-opacity-50');
      expect(highlightedLines.length).toBeGreaterThan(0);
    });
  });

  it('renders graph legend with category colors', async () => {
    wrap(<GraphPage />);
    await waitFor(() => screen.getByRole('img', { name: /knowledge graph/i }));
    expect(screen.getByLabelText(/graph legend/i)).toBeInTheDocument();
  });

  it('clicking a node sets it as focus', async () => {
    wrap(<GraphPage />);
    await waitFor(() => screen.getByRole('img', { name: /knowledge graph/i }));
    const svg = screen.getByRole('img', { name: /knowledge graph/i });
    const nodeGroups = svg.querySelectorAll('g[role="button"]');
    expect(nodeGroups.length).toBeGreaterThan(0);
    fireEvent.click(nodeGroups[0]!);
    expect(screen.getByRole('button', { name: /clear focus/i })).toBeInTheDocument();
  });
});

describe('layoutCategoryRadial', () => {
  it('returns empty array for empty input', () => {
    expect(layoutCategoryRadial([])).toEqual([]);
  });

  it('returns single node at center', () => {
    const nodes: GraphNode[] = [{ id: 'n1', title: 'Node 1', category: 'a' }];
    const result = layoutCategoryRadial(nodes);
    expect(result).toHaveLength(1);
    expect(result[0]!.x).toBe(300);
    expect(result[0]!.y).toBe(220);
  });

  it('positions nodes for multiple categories separately', () => {
    const nodes: GraphNode[] = [
      { id: 'a1', title: 'A1', category: 'alpha' },
      { id: 'a2', title: 'A2', category: 'alpha' },
      { id: 'b1', title: 'B1', category: 'beta' },
    ];
    const result = layoutCategoryRadial(nodes);
    expect(result).toHaveLength(3);

    // All nodes should be within the SVG viewBox bounds
    for (const pos of result) {
      expect(pos.x).toBeGreaterThan(0);
      expect(pos.x).toBeLessThan(600);
      expect(pos.y).toBeGreaterThan(0);
      expect(pos.y).toBeLessThan(440);
    }
  });

  it('produces deterministic output for the same input', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', title: 'Node 1', category: 'cat-a' },
      { id: 'n2', title: 'Node 2', category: 'cat-b' },
      { id: 'n3', title: 'Node 3', category: 'cat-a' },
    ];
    const r1 = layoutCategoryRadial(nodes);
    const r2 = layoutCategoryRadial(nodes);
    expect(r1).toEqual(r2);
  });

  it('respects custom center and radius parameters', () => {
    const nodes: GraphNode[] = [
      { id: 'n1', title: 'A', category: 'x' },
      { id: 'n2', title: 'B', category: 'y' },
    ];
    const result = layoutCategoryRadial(nodes, 100, 100, 50);
    for (const pos of result) {
      // All nodes should be within 50px of center (100,100) with jitter
      const dx = pos.x - 100;
      const dy = pos.y - 100;
      const dist = Math.sqrt(dx * dx + dy * dy);
      expect(dist).toBeLessThan(50 + 1); // max radius is 50
    }
  });

  it('nodes in same category are clustered in same angular sector', () => {
    const nodes: GraphNode[] = [
      { id: 'a1', title: 'A1', category: 'alpha' },
      { id: 'a2', title: 'A2', category: 'alpha' },
      { id: 'a3', title: 'A3', category: 'alpha' },
      { id: 'b1', title: 'B1', category: 'beta' },
      { id: 'b2', title: 'B2', category: 'beta' },
      { id: 'b3', title: 'B3', category: 'beta' },
    ];
    const result = layoutCategoryRadial(nodes);
    const byId = new Map(result.map((p) => [p.node.id, p]));

    const angleOf = (id: string) => {
      const p = byId.get(id)!;
      return Math.atan2(p.y - 220, p.x - 300);
    };

    // Alpha nodes should be closer to each other than to beta nodes
    const alphaAngles = ['a1', 'a2', 'a3'].map(angleOf);
    const betaAngles = ['b1', 'b2', 'b3'].map(angleOf);

    const avgAlpha = alphaAngles.reduce((s, a) => s + a, 0) / alphaAngles.length;
    const avgBeta = betaAngles.reduce((s, a) => s + a, 0) / betaAngles.length;

    // The two cluster centers should be angularly distinct
    const separation = Math.abs(avgAlpha - avgBeta);
    expect(separation).toBeGreaterThan(0.3);
  });
});
