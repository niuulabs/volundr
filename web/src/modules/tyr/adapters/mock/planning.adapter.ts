import type { IPlanningService } from '../../ports/planning.port';
import type { PlanningSession, PlanningMessage } from '../../models/planning';

const mockSession: PlanningSession = {
  id: 'plan-001',
  owner_id: 'user-1',
  session_id: 'volundr-sess-001',
  repo: 'niuulabs/volundr',
  status: 'ACTIVE',
  structure: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export class MockPlanningService implements IPlanningService {
  async spawnSession(_spec: string, _repo: string): Promise<PlanningSession> {
    return { ...mockSession };
  }

  async listSessions(): Promise<PlanningSession[]> {
    return [{ ...mockSession }];
  }

  async getSession(_id: string): Promise<PlanningSession | null> {
    return { ...mockSession };
  }

  async sendMessage(_sessionId: string, content: string): Promise<PlanningMessage> {
    return {
      id: 'msg-001',
      content,
      sender: 'user',
      created_at: new Date().toISOString(),
    };
  }

  async getMessages(_sessionId: string): Promise<PlanningMessage[]> {
    return [];
  }

  async proposeStructure(_sessionId: string, _rawJson: string): Promise<PlanningSession> {
    return { ...mockSession, status: 'STRUCTURE_PROPOSED' };
  }

  async completeSession(_sessionId: string): Promise<PlanningSession> {
    return { ...mockSession, status: 'COMPLETED' };
  }

  async deleteSession(_sessionId: string): Promise<void> {
    return;
  }
}
