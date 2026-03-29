import type { SessionInfo } from '../models';

export interface ITyrSessionService {
  getSessions(): Promise<SessionInfo[]>;
  getSession(id: string): Promise<SessionInfo | null>;
  approve(sessionId: string): Promise<void>;
}
