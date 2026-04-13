import { MarkdownContent } from '../MarkdownContent';
import { ToolBlock, ToolGroupBlock, groupContentBlocks } from '../ToolBlock';
import type { SkuldChatMessage, SkuldChatMessagePart, ParticipantStatus } from '@/modules/shared/hooks/useSkuldChat';
import type { ContentBlock as ToolContentBlock } from '../ToolBlock';
import styles from './RoomMessage.module.css';

interface RoomMessageProps {
  message: SkuldChatMessage;
  participantStatus?: ParticipantStatus;
}

function partsToContentBlocks(parts: readonly SkuldChatMessagePart[]): ToolContentBlock[] {
  const blocks: ToolContentBlock[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
      continue;
    }
    if (part.type === 'tool_use') {
      blocks.push({ type: 'tool_use', id: part.id, name: part.name, input: part.input });
      continue;
    }
    if (part.type === 'tool_result') {
      blocks.push({ type: 'tool_result', tool_use_id: part.tool_use_id, content: part.content });
    }
  }
  return blocks;
}

const ACTIVE_STATUSES: ParticipantStatus[] = ['thinking', 'tool_executing'];

export function RoomMessage({ message, participantStatus }: RoomMessageProps) {
  const { participant, content, parts } = message;
  const color = participant?.color ?? 'purple';
  const persona = participant?.persona ?? 'Ravn';
  const isActive = participantStatus !== undefined && ACTIVE_STATUSES.includes(participantStatus);

  const contentBlocks = parts ? partsToContentBlocks(parts) : null;
  const grouped = contentBlocks ? groupContentBlocks(contentBlocks) : null;

  return (
    <div className={styles.message} data-participant-color={color}>
      <div className={styles.border} />
      <div className={styles.body}>
        <div className={styles.header}>
          <span className={styles.persona}>{persona}</span>
          {isActive && <span className={styles.activityDot} aria-label="Active" />}
        </div>
        <div className={styles.content}>
          {grouped ? (
            grouped.map((item, i) => {
              if (item.kind === 'text') {
                if (!item.text.trim()) return null;
                return <MarkdownContent key={i} content={item.text} isStreaming={false} />;
              }
              if (item.kind === 'single') {
                return <ToolBlock key={i} block={item.block} result={item.result} />;
              }
              if (item.kind === 'group') {
                return <ToolGroupBlock key={i} toolName={item.toolName} blocks={item.blocks} />;
              }
              return null;
            })
          ) : (
            <MarkdownContent content={content} isStreaming={false} />
          )}
        </div>
      </div>
    </div>
  );
}
