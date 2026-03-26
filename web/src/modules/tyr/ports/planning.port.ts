import type { PlanningSession, PlanningMessage, PlanningStructure } from '../models/planning';

export interface IPlanningService {
  spawnSession(spec: string, repo: string): Promise<PlanningSession>;
  listSessions(): Promise<PlanningSession[]>;
  getSession(id: string): Promise<PlanningSession | null>;
  sendMessage(sessionId: string, content: string): Promise<PlanningMessage>;
  getMessages(sessionId: string): Promise<PlanningMessage[]>;
  proposeStructure(sessionId: string, rawJson: string): Promise<PlanningSession>;
  completeSession(sessionId: string): Promise<PlanningSession>;
  deleteSession(sessionId: string): Promise<void>;
}
