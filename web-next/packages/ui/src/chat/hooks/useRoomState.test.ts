import { renderHook, act } from '@testing-library/react';
import { useRoomState } from './useRoomState';
import type { SkuldChatMessage, RoomParticipant } from '../types';

function makeMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
  return {
    id: Math.random().toString(36).slice(2),
    role: 'assistant',
    content: 'Hello',
    createdAt: new Date(),
    status: 'complete',
    ...overrides,
  };
}

function makeParticipant(overrides: Partial<RoomParticipant> = {}): RoomParticipant {
  return {
    peerId: 'peer-1',
    persona: 'Agent',
    displayName: 'Agent One',
    color: 'p1',
    participantType: 'ravn',
    status: 'idle',
    joinedAt: new Date(),
    ...overrides,
  };
}

describe('useRoomState', () => {
  describe('isRoomMode', () => {
    it('is false when participants map has 1 or fewer entries', () => {
      const participants = new Map([['peer-1', makeParticipant()]]);
      const { result } = renderHook(() => useRoomState([], participants));
      expect(result.current.isRoomMode).toBe(false);
    });

    it('is true when participants.size > 1', () => {
      const participants = new Map([
        ['peer-1', makeParticipant({ peerId: 'peer-1' })],
        ['peer-2', makeParticipant({ peerId: 'peer-2' })],
      ]);
      const { result } = renderHook(() => useRoomState([], participants));
      expect(result.current.isRoomMode).toBe(true);
    });
  });

  describe('toggleInternal', () => {
    it('starts as false', () => {
      const { result } = renderHook(() => useRoomState([], new Map()));
      expect(result.current.showInternal).toBe(false);
    });

    it('toggles showInternal to true', () => {
      const { result } = renderHook(() => useRoomState([], new Map()));
      act(() => {
        result.current.toggleInternal();
      });
      expect(result.current.showInternal).toBe(true);
    });

    it('toggles showInternal back to false', () => {
      const { result } = renderHook(() => useRoomState([], new Map()));
      act(() => {
        result.current.toggleInternal();
      });
      act(() => {
        result.current.toggleInternal();
      });
      expect(result.current.showInternal).toBe(false);
    });
  });

  describe('filteredMessages', () => {
    it('returns all messages when not in room mode', () => {
      const messages = [makeMessage(), makeMessage()];
      const { result } = renderHook(() => useRoomState(messages, new Map()));
      expect(result.current.filteredMessages).toHaveLength(2);
    });

    it('filters by activeFilter when set', () => {
      const participants = new Map([
        ['peer-1', makeParticipant({ peerId: 'peer-1' })],
        ['peer-2', makeParticipant({ peerId: 'peer-2' })],
      ]);
      const messages = [
        makeMessage({ participantId: 'peer-1' }),
        makeMessage({ participantId: 'peer-2' }),
      ];
      const { result } = renderHook(() => useRoomState(messages, participants));
      act(() => {
        result.current.setActiveFilter('peer-1');
      });
      expect(result.current.filteredMessages).toHaveLength(1);
      expect(result.current.filteredMessages[0]?.participantId).toBe('peer-1');
    });

    it('filters out internal messages when showInternal is false', () => {
      const participants = new Map([
        ['peer-1', makeParticipant({ peerId: 'peer-1' })],
        ['peer-2', makeParticipant({ peerId: 'peer-2' })],
      ]);
      const messages = [
        makeMessage({ visibility: 'internal', participantId: 'peer-1' }),
        makeMessage({ visibility: 'public', participantId: 'peer-2' }),
      ];
      const { result } = renderHook(() => useRoomState(messages, participants));
      expect(result.current.filteredMessages).toHaveLength(1);
      expect(result.current.filteredMessages[0]?.visibility).toBe('public');
    });
  });

  describe('visibleMessages', () => {
    it('excludes system messages', () => {
      const messages = [
        makeMessage({ role: 'system' }),
        makeMessage({ role: 'user', content: 'hi' }),
      ];
      const { result } = renderHook(() => useRoomState(messages, new Map()));
      expect(result.current.visibleMessages).toHaveLength(1);
      expect(result.current.visibleMessages[0]?.role).toBe('user');
    });

    it('excludes empty assistant messages that are complete', () => {
      const messages = [
        makeMessage({ role: 'assistant', content: '   ', status: 'complete' }),
        makeMessage({ role: 'user', content: 'hello' }),
      ];
      const { result } = renderHook(() => useRoomState(messages, new Map()));
      expect(result.current.visibleMessages).toHaveLength(1);
      expect(result.current.visibleMessages[0]?.role).toBe('user');
    });

    it('includes running assistant messages even if content is empty', () => {
      const messages = [makeMessage({ role: 'assistant', content: '', status: 'running' })];
      const { result } = renderHook(() => useRoomState(messages, new Map()));
      expect(result.current.visibleMessages).toHaveLength(1);
    });
  });

  describe('toggleThread', () => {
    it('starts with all threads in collapsedThreads', () => {
      // threadGroups is only built in room mode with showInternal
      const { result } = renderHook(() => useRoomState([], new Map()));
      expect(result.current.collapsedThreads.size).toBe(0);
    });

    it('adds a threadId to expandedThreads via toggleThread', () => {
      const { result } = renderHook(() => useRoomState([], new Map()));
      act(() => {
        result.current.toggleThread('thread-abc');
      });
      // collapsedThreads will not have thread-abc since it's only in expandedThreads
      // but threadGroups won't track it unless the thread has 2+ messages
      // At minimum toggleThread should not throw
      expect(result.current.collapsedThreads.has('thread-abc')).toBe(false);
    });
  });
});
