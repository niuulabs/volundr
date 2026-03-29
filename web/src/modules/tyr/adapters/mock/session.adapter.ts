import type { ITyrSessionService } from '../../ports';
import type { SessionInfo } from '../../models';
import { mockSessions } from './data';

export class MockTyrSessionService implements ITyrSessionService {
  private sessions: SessionInfo[] = mockSessions.map(s => ({
    ...s,
    chronicle_lines: [...s.chronicle_lines],
  }));

  async getSessions(): Promise<SessionInfo[]> {
    return this.sessions.map(s => ({
      ...s,
      chronicle_lines: [...s.chronicle_lines],
    }));
  }

  async getSession(id: string): Promise<SessionInfo | null> {
    const session = this.sessions.find(s => s.session_id === id);
    if (!session) {
      return null;
    }
    return { ...session, chronicle_lines: [...session.chronicle_lines] };
  }

  async approve(sessionId: string): Promise<void> {
    const session = this.sessions.find(s => s.session_id === sessionId);
    if (session) {
      session.status = 'approved';
    }
  }
}
