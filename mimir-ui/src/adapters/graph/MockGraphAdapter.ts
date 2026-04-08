import type { GraphPort } from '@/ports';
import type { MimirGraph } from '@/domain';

/**
 * MockGraphAdapter — deterministic test double for GraphPort.
 */
export class MockGraphAdapter implements GraphPort {
  async getGraph(): Promise<MimirGraph> {
    return {
      nodes: [
        { id: 'technical/ravn/architecture.md', title: 'Ravn Architecture', category: 'technical', inboundCount: 1 },
        { id: 'technical/ravn/cascade.md', title: 'Cascade Protocol', category: 'technical', inboundCount: 0 },
        { id: 'projects/niuu/roadmap.md', title: 'Niuu Roadmap', category: 'projects', inboundCount: 0 },
        { id: 'technical/mimir/ingestion.md', title: 'Mímir Ingestion', category: 'technical', inboundCount: 0 },
      ],
      edges: [
        { source: 'technical/ravn/architecture.md', target: 'technical/ravn/cascade.md' },
      ],
    };
  }
}
