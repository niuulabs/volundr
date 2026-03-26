import { createApiClient } from '@/modules/shared/api/client';
import type {
  ITyrService,
  CommitSagaRequest,
  PlanSession,
  ExtractedStructure,
} from '../../ports';
import type { Saga, Phase } from '../../models';

const api = createApiClient('/api/v1/tyr/sagas');

interface SagaListResponse {
  id: string;
  tracker_id: string;
  tracker_type: string;
  slug: string;
  name: string;
  repos: string[];
  feature_branch: string;
  status: string;
  milestone_count: number;
  issue_count: number;
  url: string;
}

interface PhaseResponse {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  progress: number;
  raids: RaidResponse[];
}

interface RaidResponse {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assignee: string | null;
  priority: number;
  url: string;
  milestone_id: string | null;
}

interface SagaDetailResponse {
  id: string;
  tracker_id: string;
  tracker_type: string;
  slug: string;
  name: string;
  description: string;
  repos: string[];
  feature_branch: string;
  status: string;
  url: string;
  phases: PhaseResponse[];
}

export class ApiTyrService implements ITyrService {
  async getSagas(): Promise<Saga[]> {
    const items = await api.get<SagaListResponse[]>('');
    return items.map(item => ({
      id: item.id,
      tracker_id: item.tracker_id,
      tracker_type: item.tracker_type,
      slug: item.slug,
      name: item.name,
      repos: item.repos,
      feature_branch: item.feature_branch,
      status: item.status.toLowerCase() as Saga['status'],
      confidence: 0,
      created_at: '',
      phase_summary: {
        total: item.milestone_count,
        completed: 0,
      },
    }));
  }

  async getSaga(id: string): Promise<Saga | null> {
    try {
      const detail = await api.get<SagaDetailResponse>(`/${id}`);
      return {
        id: detail.id,
        tracker_id: detail.tracker_id,
        tracker_type: detail.tracker_type,
        slug: detail.slug,
        name: detail.name,
        repos: detail.repos,
        feature_branch: detail.feature_branch,
        status: detail.status.toLowerCase() as Saga['status'],
        confidence: 0,
        created_at: '',
        phase_summary: {
          total: detail.phases.length,
          completed: 0,
        },
      };
    } catch {
      return null;
    }
  }

  async getPhases(sagaId: string): Promise<Phase[]> {
    const detail = await api.get<SagaDetailResponse>(`/${sagaId}`);
    return detail.phases.map(p => ({
      id: p.id,
      saga_id: sagaId,
      tracker_id: p.id,
      number: p.sort_order,
      name: p.name,
      status: 'pending' as Phase['status'],
      confidence: 0,
      raids: p.raids.map(r => ({
        id: r.id,
        phase_id: p.id,
        tracker_id: r.id,
        name: r.title,
        description: '',
        acceptance_criteria: [],
        declared_files: [],
        estimate_hours: null,
        status: 'pending' as const,
        confidence: 0,
        session_id: null,
        branch: null,
        chronicle_summary: null,
        retry_count: 0,
        created_at: '',
        updated_at: '',
      })),
    }));
  }

  async createSaga(_spec: string, _repo: string): Promise<Saga> {
    throw new Error('Use the import flow instead');
  }

  async commitSaga(request: CommitSagaRequest): Promise<Saga> {
    const data = await api.post<{
      id: string;
      tracker_id: string;
      tracker_type: string;
      slug: string;
      name: string;
      repos: string[];
      feature_branch: string;
      base_branch: string;
      status: string;
    }>('/commit', request);
    return {
      id: data.id,
      tracker_id: data.tracker_id,
      tracker_type: data.tracker_type,
      slug: data.slug,
      name: data.name,
      repos: data.repos,
      feature_branch: data.feature_branch,
      status: data.status.toLowerCase() as Saga['status'],
      confidence: 0,
      created_at: '',
      phase_summary: { total: request.phases.length, completed: 0 },
    };
  }

  async decompose(_spec: string, _repo: string): Promise<Phase[]> {
    throw new Error('Not yet implemented');
  }

  async spawnPlanSession(spec: string, repo: string): Promise<PlanSession> {
    return api.post<PlanSession>('/plan', { spec, repo });
  }

  async extractStructure(text: string): Promise<ExtractedStructure> {
    return api.post<ExtractedStructure>('/extract-structure', { text });
  }
}
