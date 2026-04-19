import { ChevronRight, ChevronDown } from 'lucide-react';
import { RoomMessage } from '../RoomMessage';
import { resolveParticipantColor } from '../utils/participantColor';
import type { SkuldChatMessage } from '../types';
import styles from './ThreadGroup.module.css';

interface ThreadGroupProps {
  messages: readonly SkuldChatMessage[];
  isCollapsed: boolean;
  onToggle: () => void;
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

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function buildTimeRange(messages: readonly SkuldChatMessage[]): string | null {
  if (messages.length === 0) return null;
  const first = messages[0];
  const last = messages[messages.length - 1];
  if (!first || !last) return null;
  const start = first.createdAt;
  const end = last.createdAt;
  const startStr = formatTime(start);
  const endStr = formatTime(end);
  if (startStr === endStr) return startStr;
  return `${startStr} \u2013 ${endStr}`;
}

function resolveThreadBorderColor(messages: readonly SkuldChatMessage[]): string {
  const firstParticipant = messages.find(m => m.participant)?.participant;
  if (!firstParticipant) return 'var(--color-border)';
  return resolveParticipantColor(firstParticipant.color);
}

export function ThreadGroup({ messages, isCollapsed, onToggle }: ThreadGroupProps) {
  const label = buildThreadLabel(messages);
  const timeRange = buildTimeRange(messages);
  const borderColor = resolveThreadBorderColor(messages);

  return (
    <div
      className={styles.group}
      style={{ '--thread-border-color': borderColor } as React.CSSProperties}
    >
      <button
        type="button"
        className={styles.header}
        onClick={onToggle}
        aria-expanded={!isCollapsed}
      >
        {isCollapsed ? (
          <ChevronRight className={styles.chevron} />
        ) : (
          <ChevronDown className={styles.chevron} />
        )}
        <span className={styles.label}>{label}</span>
        {timeRange && <span className={styles.timeRange}>{timeRange}</span>}
      </button>

      <div className={styles.body} data-expanded={!isCollapsed}>
        <div className={styles.messages}>
          {messages.map(msg => (
            <RoomMessage key={msg.id} message={msg} />
          ))}
        </div>
      </div>
    </div>
  );
}
