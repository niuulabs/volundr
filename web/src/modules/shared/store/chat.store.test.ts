import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat.store';
import type { SkuldChatMessage } from '@/modules/shared/hooks/useSkuldChat';

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

describe('useChatStore', () => {
  beforeEach(() => {
    // Reset the store between tests
    useChatStore.setState({ sessions: {} });
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
});
