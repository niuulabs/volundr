import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpGraphAdapter } from '@/adapters/graph/HttpGraphAdapter';

const BASE_URL = 'http://localhost:7477/mimir';

function mockFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('HttpGraphAdapter', () => {
  let adapter: HttpGraphAdapter;

  beforeEach(() => {
    adapter = new HttpGraphAdapter(BASE_URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getGraph()', () => {
    it('fetches /graph endpoint', async () => {
      const fetchMock = mockFetch({ nodes: [], edges: [] });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.getGraph();

      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/graph`);
    });

    it('returns nodes and edges from response', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          nodes: [
            { id: 'technical/ravn/arch.md', title: 'Ravn Arch', category: 'technical' },
            { id: 'technical/ravn/cascade.md', title: 'Cascade', category: 'technical' },
          ],
          edges: [
            { source: 'technical/ravn/arch.md', target: 'technical/ravn/cascade.md' },
          ],
        }),
      );

      const graph = await adapter.getGraph();

      expect(graph.nodes).toHaveLength(2);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0].source).toBe('technical/ravn/arch.md');
      expect(graph.edges[0].target).toBe('technical/ravn/cascade.md');
    });

    it('computes inboundCount for nodes with inbound edges', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          nodes: [
            { id: 'a.md', title: 'A', category: 'technical' },
            { id: 'b.md', title: 'B', category: 'technical' },
          ],
          edges: [{ source: 'a.md', target: 'b.md' }],
        }),
      );

      const graph = await adapter.getGraph();

      const nodeB = graph.nodes.find((n) => n.id === 'b.md');
      expect(nodeB?.inboundCount).toBe(1);
    });

    it('gives nodes with no inbound edges inboundCount=0', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          nodes: [
            { id: 'a.md', title: 'A', category: 'technical' },
            { id: 'b.md', title: 'B', category: 'technical' },
          ],
          edges: [{ source: 'a.md', target: 'b.md' }],
        }),
      );

      const graph = await adapter.getGraph();

      const nodeA = graph.nodes.find((n) => n.id === 'a.md');
      expect(nodeA?.inboundCount).toBe(0);
    });

    it('handles multiple inbound edges to same target', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          nodes: [
            { id: 'a.md', title: 'A', category: 'technical' },
            { id: 'b.md', title: 'B', category: 'technical' },
            { id: 'c.md', title: 'C', category: 'technical' },
          ],
          edges: [
            { source: 'a.md', target: 'c.md' },
            { source: 'b.md', target: 'c.md' },
          ],
        }),
      );

      const graph = await adapter.getGraph();

      const nodeC = graph.nodes.find((n) => n.id === 'c.md');
      expect(nodeC?.inboundCount).toBe(2);
    });

    it('handles empty graph', async () => {
      vi.stubGlobal('fetch', mockFetch({ nodes: [], edges: [] }));

      const graph = await adapter.getGraph();

      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });

    it('maps node fields correctly', async () => {
      vi.stubGlobal(
        'fetch',
        mockFetch({
          nodes: [{ id: 'tech/page.md', title: 'My Page', category: 'technical' }],
          edges: [],
        }),
      );

      const graph = await adapter.getGraph();

      expect(graph.nodes[0].id).toBe('tech/page.md');
      expect(graph.nodes[0].title).toBe('My Page');
      expect(graph.nodes[0].category).toBe('technical');
      expect(graph.nodes[0].inboundCount).toBe(0);
    });

    it('throws on HTTP error', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 500));

      await expect(adapter.getGraph()).rejects.toThrow('Graph HTTP 500');
    });

    it('throws on 404 status', async () => {
      vi.stubGlobal('fetch', mockFetch({}, 404));

      await expect(adapter.getGraph()).rejects.toThrow('Graph HTTP 404');
    });
  });
});
