import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { SkuldChatMessage } from '@/hooks/useSkuldChat';

/**
 * Serialisable shape stored in sessionStorage.
 * Dates are stored as ISO strings and rehydrated on read.
 */
interface SerializedMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly createdAt: string;
  readonly status: 'running' | 'complete' | 'error';
  readonly metadata?: SkuldChatMessage['metadata'];
}

interface ChatStoreState {
  /** Messages keyed by WebSocket URL */
  sessions: Record<string, SerializedMessage[]>;
}

interface ChatStoreActions {
  /** Persist current messages for a session URL */
  setMessages: (url: string, messages: readonly SkuldChatMessage[]) => void;
  /** Retrieve persisted messages for a session URL */
  getMessages: (url: string) => SkuldChatMessage[];
  /** Clear persisted messages for a session URL */
  clearSession: (url: string) => void;
}

function serialize(msgs: readonly SkuldChatMessage[]): SerializedMessage[] {
  return msgs.map(m => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }));
}

function deserialize(msgs: SerializedMessage[]): SkuldChatMessage[] {
  return msgs.map(m => ({
    ...m,
    createdAt: new Date(m.createdAt),
  }));
}

export const useChatStore = create<ChatStoreState & ChatStoreActions>()(
  persist(
    (set, get) => ({
      sessions: {},

      setMessages: (url, messages) => {
        set(state => ({
          sessions: {
            ...state.sessions,
            [url]: serialize(messages),
          },
        }));
      },

      getMessages: url => {
        const stored = get().sessions[url];
        if (!stored || stored.length === 0) {
          return [];
        }
        return deserialize(stored);
      },

      clearSession: url => {
        set(state => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [url]: _removed, ...rest } = state.sessions;
          return { sessions: rest };
        });
      },
    }),
    {
      name: 'volundr-chat',
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
