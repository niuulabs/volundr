import type {
  ITyrService,
  CommitSagaRequest,
  PlanSession,
  ExtractedStructure,
} from '../../ports';
import type { Saga, Phase } from '../../models';
import { mockSagas, mockPhases } from './data';

let mockTrackerSeq = 100;

export class MockTyrService implements ITyrService {
  async getSagas(): Promise<Saga[]> {
    return [...mockSagas];
  }

  async getSaga(id: string): Promise<Saga | null> {
    return mockSagas.find(s => s.id === id) ?? null;
  }

  async getPhases(sagaId: string): Promise<Phase[]> {
    const phases = mockPhases.get(sagaId);
    if (!phases) {
      return [];
    }
    return phases.map(p => ({ ...p, raids: [...p.raids] }));
  }

  async createSaga(spec: string, repo: string): Promise<Saga> {
    const saga: Saga = {
      id: crypto.randomUUID(),
      tracker_id: `NIU-${++mockTrackerSeq}`,
      tracker_type: 'linear',
      slug: spec.toLowerCase().replace(/\s+/g, '-').slice(0, 40),
      name: spec,
      repos: [repo],
      feature_branch: `feat/${spec.toLowerCase().replace(/\s+/g, '-').slice(0, 30)}`,
      status: 'active',
      confidence: 0.5,
      created_at: new Date().toISOString(),
      phase_summary: { total: 0, completed: 0 },
    };
    return saga;
  }

  async commitSaga(request: CommitSagaRequest): Promise<Saga> {
    return {
      id: crypto.randomUUID(),
      tracker_id: `NIU-${++mockTrackerSeq}`,
      tracker_type: 'linear',
      slug: request.slug,
      name: request.name,
      repos: request.repos,
      feature_branch: `feat/${request.slug}`,
      status: 'active',
      confidence: 0.5,
      created_at: new Date().toISOString(),
      phase_summary: { total: request.phases.length, completed: 0 },
    };
  }

  async spawnPlanSession(_spec: string, _repo: string): Promise<PlanSession> {
    await new Promise(resolve => setTimeout(resolve, 300));
    return {
      session_id: crypto.randomUUID(),
      chat_endpoint: `wss://sessions.mock/s/${crypto.randomUUID()}/session`,
    };
  }

  async extractStructure(_text: string): Promise<ExtractedStructure> {
    return { found: false, structure: null };
  }

  async decompose(spec: string, repo: string): Promise<Phase[]> {
    // Simulate decomposition delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const sagaId = crypto.randomUUID();
    return [
      {
        id: crypto.randomUUID(),
        saga_id: sagaId,
        tracker_id: `NIU-${++mockTrackerSeq}`,
        number: 1,
        name: `Phase 1: Setup for ${spec}`,
        status: 'pending',
        confidence: 0.5,
        raids: [
          {
            id: crypto.randomUUID(),
            phase_id: '',
            tracker_id: `NIU-${++mockTrackerSeq}`,
            name: `Scaffold ${spec} infrastructure`,
            description: `Set up the foundational infrastructure for ${spec} in ${repo}.`,
            acceptance_criteria: [
              'Port interface defined',
              'Adapter stub created',
              'Tests passing',
            ],
            declared_files: ['src/ports/new_port.py', 'src/adapters/new_adapter.py'],
            estimate_hours: 3,
            status: 'pending',
            confidence: 0.5,
            session_id: null,
            branch: null,
            chronicle_summary: null,
            retry_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      },
    ];
  }
}
