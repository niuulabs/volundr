import { useState, useMemo, useCallback } from 'react';
import type { SkuldChatMessage } from './useSkuldChat';
import type { RoomParticipant } from './useSkuldChat';

export interface ThreadGroupData {
  threadId: string;
  messages: readonly SkuldChatMessage[];
  participants: ReadonlySet<string>;
  startTime: Date;
  endTime: Date;
}

export interface UseRoomStateReturn {
  participants: ReadonlyMap<string, RoomParticipant>;
  isRoomMode: boolean;
  activeFilter: string;
  setActiveFilter: (f: string) => void;
  showInternal: boolean;
  toggleInternal: () => void;
  filteredMessages: readonly SkuldChatMessage[];
  collapsedThreads: ReadonlySet<string>;
  toggleThread: (threadId: string) => void;
  threadGroups: ReadonlyMap<string, ThreadGroupData>;
}

const FILTER_ALL = 'all';

export function useRoomState(
  messages: readonly SkuldChatMessage[],
  participants: ReadonlyMap<string, RoomParticipant>
): UseRoomStateReturn {
  const [activeFilter, setActiveFilter] = useState<string>(FILTER_ALL);
  const [showInternal, setShowInternal] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<ReadonlySet<string>>(new Set());

  const isRoomMode = participants.size > 1;

  const toggleInternal = useCallback(() => {
    setShowInternal(prev => !prev);
  }, []);

  const toggleThread = useCallback((threadId: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  }, []);

  const filteredMessages = useMemo(() => {
    if (!isRoomMode) return messages;

    return messages.filter(msg => {
      if (!showInternal && msg.visibility === 'internal') return false;
      if (activeFilter !== FILTER_ALL && msg.participantId !== activeFilter) return false;
      return true;
    });
  }, [messages, isRoomMode, activeFilter, showInternal]);

  const threadGroups = useMemo((): ReadonlyMap<string, ThreadGroupData> => {
    if (!isRoomMode || !showInternal) return new Map();

    const groups = new Map<string, ThreadGroupData>();
    let i = 0;
    while (i < filteredMessages.length) {
      const msg = filteredMessages[i];
      if (msg.visibility === 'internal' && msg.threadId) {
        const threadId = msg.threadId;
        const threadMsgs: SkuldChatMessage[] = [msg];
        let j = i + 1;
        while (j < filteredMessages.length) {
          const next = filteredMessages[j];
          if (next.visibility === 'internal' && next.threadId === threadId) {
            threadMsgs.push(next);
            j++;
          } else {
            break;
          }
        }
        if (threadMsgs.length > 1) {
          const participantIds = new Set<string>(
            threadMsgs.map(m => m.participantId).filter((id): id is string => id !== undefined)
          );
          groups.set(threadId, {
            threadId,
            messages: threadMsgs,
            participants: participantIds,
            startTime: threadMsgs[0].createdAt,
            endTime: threadMsgs[threadMsgs.length - 1].createdAt,
          });
          i = j;
          continue;
        }
      }
      i++;
    }
    return groups;
  }, [filteredMessages, isRoomMode, showInternal]);

  const collapsedThreads = useMemo((): ReadonlySet<string> => {
    const collapsed = new Set<string>();
    for (const threadId of threadGroups.keys()) {
      if (!expandedThreads.has(threadId)) {
        collapsed.add(threadId);
      }
    }
    return collapsed;
  }, [threadGroups, expandedThreads]);

  return {
    participants,
    isRoomMode,
    activeFilter,
    setActiveFilter,
    showInternal,
    toggleInternal,
    filteredMessages,
    collapsedThreads,
    toggleThread,
    threadGroups,
  };
}
