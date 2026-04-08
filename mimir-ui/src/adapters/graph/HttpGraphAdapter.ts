import type { GraphPort } from '@/ports';
import type { MimirGraph, GraphNode, GraphEdge } from '@/domain';

/**
 * HttpGraphAdapter — fetches graph data from GET /mimir/graph.
 * Computes inbound link counts from the edge list.
 */
export class HttpGraphAdapter implements GraphPort {
  constructor(private readonly baseUrl: string) {}

  async getGraph(): Promise<MimirGraph> {
    const res = await fetch(`${this.baseUrl}/graph`);
    if (!res.ok) {
      throw new Error(`Graph HTTP ${res.status}`);
    }
    const raw = (await res.json()) as { nodes: { id: string; title: string; category: string }[]; edges: { source: string; target: string }[] };

    const inboundCounts = new Map<string, number>();
    for (const edge of raw.edges) {
      inboundCounts.set(edge.target, (inboundCounts.get(edge.target) ?? 0) + 1);
    }

    const nodes: GraphNode[] = raw.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      category: n.category,
      inboundCount: inboundCounts.get(n.id) ?? 0,
    }));

    const edges: GraphEdge[] = raw.edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    return { nodes, edges };
  }
}
