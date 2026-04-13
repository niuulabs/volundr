import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useRoomState } from './useRoomState';
import type { SkuldChatMessage } from './useSkuldChat';
import type { RoomParticipant } from './useSkuldChat';

function makeParticipant(overrides: Partial<RoomParticipant> = {}): RoomParticipant {
  return {
    peerId: 'peer-1',
    persona: 'Ravn-A',
    color: 'amber',
    participantType: 'ravn',
    status: 'idle',
    joinedAt: new Date(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<SkuldChatMessage> = {}): SkuldChatMessage {
  return {
    id: `msg-${Math.random()}`,
    role: 'assistant',
    content: 'hello',
    createdAt: new Date(),
    status: 'complete',
    ...overrides,
  };
}

function makeParticipantsMap(participants: RoomParticipant[]): ReadonlyMap<string, RoomParticipant> {
  return new Map(participants.map(p => [p.peerId, p]));
}

describe('useRoomState', () => {
  describe('isRoomMode', () => {
    it('is false when 0 participants', () => {
      const { result } = renderHook(() =>
        useRoomState([], new Map())
      );
      expect(result.current.isRoomMode).toBe(false);
    });

    it('is false when 1 participant', () => {
      const participants = makeParticipantsMap([makeParticipant()]);
      const { result } = renderHook(() => useRoomState([], participants));
      expect(result.current.isRoomMode).toBe(false);
    });

    it('is true when 2+ participants', () => {
      const participants = makeParticipantsMap([
        makeParticipant({ peerId: 'peer-1', persona: 'Ravn-A' }),
        makeParticipant({ peerId: 'peer-2', persona: 'Ravn-B' }),
      ]);
      const { result } = renderHook(() => useRoomState([], participants));
      expect(result.current.isRoomMode).toBe(true);
    });
  });

  describe('filtering by participant', () => {
    const participants = makeParticipantsMap([
      makeParticipant({ peerId: 'peer-1', persona: 'Ravn-A' }),
      makeParticipant({ peerId: 'peer-2', persona: 'Ravn-B' }),
    ]);
    const messages = [
      makeMessage({ id: 'msg-1', participantId: 'peer-1' }),
      makeMessage({ id: 'msg-2', participantId: 'peer-2' }),
      makeMessage({ id: 'msg-3', participantId: 'peer-1' }),
    ];

    it('returns all messages when activeFilter is "all"', () => {
      const { result } = renderHook(() => useRoomState(messages, participants));
      expect(result.current.filteredMessages).toHaveLength(3);
    });

    it('filters to specific participant', () => {
      const { result } = renderHook(() => useRoomState(messages, participants));

      act(() => {
        result.current.setActiveFilter('peer-1');
      });

      expect(result.current.filteredMessages).toHaveLength(2);
      expect(result.current.filteredMessages.every(m => m.participantId === 'peer-1')).toBe(true);
    });

    it('filters to another participant', () => {
      const { result } = renderHook(() => useRoomState(messages, participants));

      act(() => {
        result.current.setActiveFilter('peer-2');
      });

      expect(result.current.filteredMessages).toHaveLength(1);
      expect(result.current.filteredMessages[0].id).toBe('msg-2');
    });

    it('restores all messages when filter set back to "all"', () => {
      const { result } = renderHook(() => useRoomState(messages, participants));

      act(() => {
        result.current.setActiveFilter('peer-1');
      });
      act(() => {
        result.current.setActiveFilter('all');
      });

      expect(result.current.filteredMessages).toHaveLength(3);
    });
  });

  describe('internal message toggle', () => {
    const participants = makeParticipantsMap([
      makeParticipant({ peerId: 'peer-1', persona: 'Ravn-A' }),
      makeParticipant({ peerId: 'peer-2', persona: 'Ravn-B' }),
    ]);
    const messages = [
      makeMessage({ id: 'msg-1', visibility: 'public' }),
      makeMessage({ id: 'msg-2', visibility: 'internal' }),
      makeMessage({ id: 'msg-3' }),
    ];

    it('hides internal messages by default', () => {
      const { result } = renderHook(() => useRoomState(messages, participants));
      const ids = result.current.filteredMessages.map(m => m.id);
      expect(ids).not.toContain('msg-2');
      expect(ids).toContain('msg-1');
      expect(ids).toContain('msg-3');
    });

    it('shows internal messages after toggle', () => {
      const { result } = renderHook(() => useRoomState(messages, participants));

      act(() => {
        result.current.toggleInternal();
      });

      const ids = result.current.filteredMessages.map(m => m.id);
      expect(ids).toContain('msg-2');
    });

    it('hides internal again after second toggle', () => {
      const { result } = renderHook(() => useRoomState(messages, participants));

      act(() => { result.current.toggleInternal(); });
      act(() => { result.current.toggleInternal(); });

      const ids = result.current.filteredMessages.map(m => m.id);
      expect(ids).not.toContain('msg-2');
    });

    it('showInternal starts false', () => {
      const { result } = renderHook(() => useRoomState([], participants));
      expect(result.current.showInternal).toBe(false);
    });

    it('showInternal becomes true after toggle', () => {
      const { result } = renderHook(() => useRoomState([], participants));
      act(() => { result.current.toggleInternal(); });
      expect(result.current.showInternal).toBe(true);
    });
  });

  describe('passthrough in single-agent mode', () => {
    const singleParticipant = makeParticipantsMap([makeParticipant()]);
    const messages = [
      makeMessage({ id: 'msg-1', visibility: 'internal' }),
      makeMessage({ id: 'msg-2', visibility: 'public' }),
    ];

    it('returns all messages unfiltered when not room mode', () => {
      const { result } = renderHook(() => useRoomState(messages, singleParticipant));
      expect(result.current.filteredMessages).toHaveLength(2);
    });
  });

  describe('activeFilter state', () => {
    it('defaults to "all"', () => {
      const { result } = renderHook(() => useRoomState([], new Map()));
      expect(result.current.activeFilter).toBe('all');
    });

    it('updates via setActiveFilter', () => {
      const { result } = renderHook(() => useRoomState([], new Map()));
      act(() => { result.current.setActiveFilter('peer-42'); });
      expect(result.current.activeFilter).toBe('peer-42');
    });
  });
});
