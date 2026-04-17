import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat.store';
import type {
  SkuldChatMessage,
  MeshEvent,
  MeshOutcomeEvent,
} from '@/modules/shared/hooks/useSkuldChat';

function makeMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content: 'Hello',
    createdAt: new Date('2025-06-01T12:00:00Z'),
    status: 'complete',
    ...overrides,
  };
}

function makeMeshEvent(overrides: Partial<MeshOutcomeEvent> = {}): MeshOutcomeEvent {
  return {
    type: 'outcome',
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date('2025-07-01T08:00:00Z'),
    participantId: 'agent-001',
    participant: {
      peerId: 'agent-001',
      persona: 'Ravn',
      color: 'p2',
      participantType: 'ravn',
    },
    persona: 'Ravn',
    eventType: 'review.passed',
    fields: { score: 95 },
    valid: true,
    ...overrides,
  };
}

describe('useChatStore', () => {
  beforeEach(() => {
    // Reset the store between tests
    useChatStore.setState({ sessions: {}, meshEventSessions: {} });
  });

  it('initializes with empty sessions', () => {
    const state = useChatStore.getState();
    expect(state.sessions).toEqual({});
  });

  it('returns empty array for unknown session URL', () => {
    const { getMessages } = useChatStore.getState();
    expect(getMessages('wss://unknown/session')).toEqual([]);
  });

  it('persists and retrieves messages for a session', () => {
    const { setMessages, getMessages } = useChatStore.getState();
    const url = 'wss://host1/session';
    const msgs: SkuldChatMessage[] = [
      makeMessage({ id: 'u1', role: 'user', content: 'Hi' }),
      makeMessage({ id: 'a1', role: 'assistant', content: 'Hello!' }),
    ];

    setMessages(url, msgs);
    const restored = getMessages(url);

    expect(restored).toHaveLength(2);
    expect(restored[0].id).toBe('u1');
    expect(restored[0].role).toBe('user');
    expect(restored[0].content).toBe('Hi');
    expect(restored[1].id).toBe('a1');
    expect(restored[1].content).toBe('Hello!');
  });

  it('serializes Date to ISO string and deserializes back', () => {
    const { setMessages, getMessages } = useChatStore.getState();
    const url = 'wss://host/session';
    const date = new Date('2025-06-15T10:30:00Z');
    const msgs = [makeMessage({ createdAt: date })];

    setMessages(url, msgs);
    const restored = getMessages(url);

    expect(restored[0].createdAt).toBeInstanceOf(Date);
    expect(restored[0].createdAt.toISOString()).toBe('2025-06-15T10:30:00.000Z');
  });

  it('preserves metadata through serialization', () => {
    const { setMessages, getMessages } = useChatStore.getState();
    const url = 'wss://host/session';
    const msgs = [
      makeMessage({
        metadata: {
          usage: {
            'claude-sonnet-4-5-20250514': {
              inputTokens: 100,
              outputTokens: 50,
              costUSD: 0.01,
            },
          },
          cost: 0.05,
          turns: 2,
        },
      }),
    ];

    setMessages(url, msgs);
    const restored = getMessages(url);

    expect(restored[0].metadata?.cost).toBe(0.05);
    expect(restored[0].metadata?.turns).toBe(2);
    expect(restored[0].metadata?.usage?.['claude-sonnet-4-5-20250514']?.inputTokens).toBe(100);
  });

  it('keeps sessions independent', () => {
    const { setMessages, getMessages } = useChatStore.getState();
    const url1 = 'wss://host1/session';
    const url2 = 'wss://host2/session';

    setMessages(url1, [makeMessage({ id: 'a', content: 'from host1' })]);
    setMessages(url2, [makeMessage({ id: 'b', content: 'from host2' })]);

    expect(getMessages(url1)).toHaveLength(1);
    expect(getMessages(url1)[0].content).toBe('from host1');
    expect(getMessages(url2)).toHaveLength(1);
    expect(getMessages(url2)[0].content).toBe('from host2');
  });

  it('overwrites messages for the same URL', () => {
    const { setMessages, getMessages } = useChatStore.getState();
    const url = 'wss://host/session';

    setMessages(url, [makeMessage({ id: 'old', content: 'old' })]);
    setMessages(url, [makeMessage({ id: 'new', content: 'new' })]);

    const restored = getMessages(url);
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('new');
  });

  it('clears a specific session', () => {
    const { setMessages, getMessages, clearSession } = useChatStore.getState();
    const url1 = 'wss://host1/session';
    const url2 = 'wss://host2/session';

    setMessages(url1, [makeMessage({ content: 'keep' })]);
    setMessages(url2, [makeMessage({ content: 'remove' })]);

    clearSession(url2);

    expect(getMessages(url1)).toHaveLength(1);
    expect(getMessages(url2)).toEqual([]);
  });

  it('handles clearing a non-existent session gracefully', () => {
    const { clearSession, getMessages } = useChatStore.getState();

    clearSession('wss://nonexistent/session');
    expect(getMessages('wss://nonexistent/session')).toEqual([]);
  });

  it('handles empty message arrays', () => {
    const { setMessages, getMessages } = useChatStore.getState();
    const url = 'wss://host/session';

    setMessages(url, []);
    expect(getMessages(url)).toEqual([]);
  });

  it('preserves system message metadata', () => {
    const { setMessages, getMessages } = useChatStore.getState();
    const url = 'wss://host/session';
    const msgs = [
      makeMessage({
        metadata: {
          messageType: 'system',
          systemSubtype: 'init',
        },
      }),
    ];

    setMessages(url, msgs);
    const restored = getMessages(url);

    expect(restored[0].metadata?.messageType).toBe('system');
    expect(restored[0].metadata?.systemSubtype).toBe('init');
  });

  it('preserves message status through serialization', () => {
    const { setMessages, getMessages } = useChatStore.getState();
    const url = 'wss://host/session';
    const msgs = [
      makeMessage({ status: 'running' }),
      makeMessage({ status: 'complete' }),
      makeMessage({ status: 'error' }),
    ];

    setMessages(url, msgs);
    const restored = getMessages(url);

    expect(restored[0].status).toBe('running');
    expect(restored[1].status).toBe('complete');
    expect(restored[2].status).toBe('error');
  });

  describe('mesh events', () => {
    it('returns empty array for unknown session URL', () => {
      const { getMeshEvents } = useChatStore.getState();
      expect(getMeshEvents('wss://unknown/session')).toEqual([]);
    });

    it('persists and retrieves mesh events for a session', () => {
      const { setMeshEvents, getMeshEvents } = useChatStore.getState();
      const url = 'wss://host/session';
      const events: MeshEvent[] = [
        makeMeshEvent({ id: 'e1', eventType: 'review.passed' }),
        makeMeshEvent({ id: 'e2', eventType: 'security.changes_requested' }),
      ];

      setMeshEvents(url, events);
      const restored = getMeshEvents(url);

      expect(restored).toHaveLength(2);
      expect(restored[0].id).toBe('e1');
      expect(restored[1].id).toBe('e2');
    });

    it('serializes timestamp to ISO string and deserializes back to Date', () => {
      const { setMeshEvents, getMeshEvents } = useChatStore.getState();
      const url = 'wss://host/session';
      const date = new Date('2025-07-15T14:30:00Z');
      const events: MeshEvent[] = [makeMeshEvent({ timestamp: date })];

      setMeshEvents(url, events);
      const restored = getMeshEvents(url);

      expect(restored[0].timestamp).toBeInstanceOf(Date);
      expect(restored[0].timestamp.toISOString()).toBe('2025-07-15T14:30:00.000Z');
    });

    it('preserves event fields through serialization', () => {
      const { setMeshEvents, getMeshEvents } = useChatStore.getState();
      const url = 'wss://host/session';
      const events: MeshEvent[] = [
        makeMeshEvent({
          eventType: 'review.passed',
          fields: { score: 95, reviewer: 'bot' },
          valid: true,
          summary: 'All checks passed',
          verdict: 'approved',
        }),
      ];

      setMeshEvents(url, events);
      const restored = getMeshEvents(url);

      expect(restored[0].type).toBe('outcome');
      expect((restored[0] as MeshOutcomeEvent).eventType).toBe('review.passed');
      expect((restored[0] as MeshOutcomeEvent).fields).toEqual({ score: 95, reviewer: 'bot' });
      expect((restored[0] as MeshOutcomeEvent).summary).toBe('All checks passed');
      expect((restored[0] as MeshOutcomeEvent).verdict).toBe('approved');
    });

    it('returns empty array for empty stored mesh events', () => {
      const { setMeshEvents, getMeshEvents } = useChatStore.getState();
      const url = 'wss://host/session';

      setMeshEvents(url, []);
      expect(getMeshEvents(url)).toEqual([]);
    });

    it('overwrites mesh events for the same URL', () => {
      const { setMeshEvents, getMeshEvents } = useChatStore.getState();
      const url = 'wss://host/session';

      setMeshEvents(url, [makeMeshEvent({ id: 'old' })]);
      setMeshEvents(url, [makeMeshEvent({ id: 'new' })]);

      const restored = getMeshEvents(url);
      expect(restored).toHaveLength(1);
      expect(restored[0].id).toBe('new');
    });

    it('clearSession removes mesh events along with messages', () => {
      const { setMeshEvents, getMeshEvents, setMessages, getMessages, clearSession } =
        useChatStore.getState();
      const url = 'wss://host/session';

      setMessages(url, [makeMessage({ content: 'msg' })]);
      setMeshEvents(url, [makeMeshEvent({ id: 'evt' })]);

      clearSession(url);

      expect(getMessages(url)).toEqual([]);
      expect(getMeshEvents(url)).toEqual([]);
    });
  });
});
