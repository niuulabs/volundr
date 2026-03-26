import { createApiClient } from '@/modules/shared/api/client';
import type { IPlanningService } from '../../ports/planning.port';
import type { PlanningSession, PlanningMessage } from '../../models/planning';

const api = createApiClient('/api/v1/tyr/planning');

export class ApiPlanningService implements IPlanningService {
  async spawnSession(spec: string, repo: string): Promise<PlanningSession> {
    return api.post<PlanningSession>('/sessions', { spec, repo });
  }

  async listSessions(): Promise<PlanningSession[]> {
    return api.get<PlanningSession[]>('/sessions');
  }

  async getSession(id: string): Promise<PlanningSession | null> {
    try {
      return await api.get<PlanningSession>(`/sessions/${id}`);
    } catch {
      return null;
    }
  }

  async sendMessage(sessionId: string, content: string): Promise<PlanningMessage> {
    return api.post<PlanningMessage>(`/sessions/${sessionId}/messages`, { content });
  }

  async getMessages(sessionId: string): Promise<PlanningMessage[]> {
    return api.get<PlanningMessage[]>(`/sessions/${sessionId}/messages`);
  }

  async proposeStructure(sessionId: string, rawJson: string): Promise<PlanningSession> {
    return api.post<PlanningSession>(`/sessions/${sessionId}/structure`, {
      raw_json: rawJson,
    });
  }

  async completeSession(sessionId: string): Promise<PlanningSession> {
    return api.post<PlanningSession>(`/sessions/${sessionId}/complete`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await api.delete(`/sessions/${sessionId}`);
  }
}
