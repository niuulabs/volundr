import { useState, useMemo, useCallback } from 'react';
import type { SkuldChatMessage } from './useSkuldChat';
import type { RoomParticipant } from './useSkuldChat';

export interface UseRoomStateReturn {
  participants: ReadonlyMap<string, RoomParticipant>;
  isRoomMode: boolean;
  activeFilter: string;
  setActiveFilter: (f: string) => void;
  showInternal: boolean;
  toggleInternal: () => void;
  filteredMessages: readonly SkuldChatMessage[];
}

const FILTER_ALL = 'all';

export function useRoomState(
  messages: readonly SkuldChatMessage[],
  participants: ReadonlyMap<string, RoomParticipant>
): UseRoomStateReturn {
  const [activeFilter, setActiveFilter] = useState<string>(FILTER_ALL);
  const [showInternal, setShowInternal] = useState(false);

  const isRoomMode = participants.size > 1;

  const toggleInternal = useCallback(() => {
    setShowInternal(prev => !prev);
  }, []);

  const filteredMessages = useMemo(() => {
    if (!isRoomMode) return messages;

    return messages.filter(msg => {
      if (!showInternal && msg.visibility === 'internal') return false;
      if (activeFilter !== FILTER_ALL && msg.participantId !== activeFilter) return false;
      return true;
    });
  }, [messages, isRoomMode, activeFilter, showInternal]);

  return {
    participants,
    isRoomMode,
    activeFilter,
    setActiveFilter,
    showInternal,
    toggleInternal,
    filteredMessages,
  };
}
