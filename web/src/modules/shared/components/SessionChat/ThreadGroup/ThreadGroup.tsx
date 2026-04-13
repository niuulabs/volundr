import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { RoomMessage } from '../RoomMessage';
import type { SkuldChatMessage } from '@/modules/shared/hooks/useSkuldChat';
import type { RoomParticipant } from '@/modules/shared/hooks/useSkuldChat';
import styles from './ThreadGroup.module.css';

interface ThreadGroupProps {
  messages: readonly SkuldChatMessage[];
  participants: ReadonlyMap<string, RoomParticipant>;
}

function buildThreadLabel(messages: readonly SkuldChatMessage[]): string {
  const personas = new Set<string>();
  for (const msg of messages) {
    if (msg.participant?.persona) {
      personas.add(msg.participant.persona);
    }
  }
  const count = messages.length;
  const participantStr = Array.from(personas).join(' \u2194 ');
  const msgWord = count === 1 ? 'message' : 'messages';
  return participantStr ? `${participantStr} \u2014 ${count} ${msgWord}` : `${count} ${msgWord}`;
}

export function ThreadGroup({ messages }: ThreadGroupProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded(prev => !prev), []);

  const label = buildThreadLabel(messages);

  return (
    <div className={styles.group}>
      <button type="button" className={styles.header} onClick={toggle} aria-expanded={expanded}>
        {expanded ? (
          <ChevronDown className={styles.chevron} />
        ) : (
          <ChevronRight className={styles.chevron} />
        )}
        <span className={styles.label}>{label}</span>
      </button>

      <div className={styles.body} data-expanded={expanded}>
        <div className={styles.messages}>
          {messages.map(msg => (
            <RoomMessage key={msg.id} message={msg} />
          ))}
        </div>
      </div>
    </div>
  );
}
