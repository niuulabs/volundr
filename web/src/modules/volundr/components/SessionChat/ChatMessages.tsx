import { useState, useCallback } from 'react';
import {
  Hammer,
  Copy,
  Check,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  ChevronRight,
  ChevronDown,
  Loader2,
  Terminal,
  Paperclip,
} from 'lucide-react';
import { cn } from '@/utils';
import { MarkdownContent } from './MarkdownContent';
import { ToolBlock, ToolGroupBlock, groupContentBlocks } from './ToolBlock';
import type { SkuldChatMessage, SkuldChatMessagePart } from '@/modules/volundr/hooks/useSkuldChat';
import type { ContentBlock as ToolContentBlock } from './ToolBlock';
import styles from './ChatMessages.module.css';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const formatTime = (date: Date): string =>
  date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Check if message parts contain any tool_use blocks.
 */
function hasToolParts(parts?: readonly SkuldChatMessagePart[]): boolean {
  return parts?.some(p => p.type === 'tool_use') ?? false;
}

/**
 * Convert message parts to ToolContentBlock array for groupContentBlocks.
 * Filters out reasoning parts (handled separately).
 */
function partsToContentBlocks(parts: readonly SkuldChatMessagePart[]): ToolContentBlock[] {
  const blocks: ToolContentBlock[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'tool_use') {
      blocks.push({ type: 'tool_use', id: part.id, name: part.name, input: part.input });
    } else if (part.type === 'tool_result') {
      blocks.push({ type: 'tool_result', tool_use_id: part.tool_use_id, content: part.content });
    }
    // reasoning parts are handled separately
  }
  return blocks;
}

/**
 * Extract total input/output tokens from the metadata usage record.
 * The usage map is keyed by model name; we sum across all entries.
 */
function extractTokens(usage: Record<string, { inputTokens?: number; outputTokens?: number }>): {
  input: number;
  output: number;
} {
  let input = 0;
  let output = 0;
  for (const entry of Object.values(usage)) {
    input += entry.inputTokens ?? 0;
    output += entry.outputTokens ?? 0;
  }
  return { input, output };
}

/* ------------------------------------------------------------------ */
/*  UserMessage                                                        */
/* ------------------------------------------------------------------ */

interface UserMessageProps {
  message: SkuldChatMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  return (
    <div className={styles.userMessageWrapper}>
      <div className={styles.userBubble}>
        <div className={styles.userText}>{message.content}</div>

        {message.attachments && message.attachments.length > 0 && (
          <div className={styles.attachmentRow}>
            {message.attachments.map((att, i) => (
              <span key={`${att.name}-${i}`} className={styles.attachmentBadge}>
                <Paperclip className={styles.attachmentIcon} />
                <span>{att.name}</span>
                <span className={styles.attachmentSize}>{formatFileSize(att.size)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={styles.userMeta}>
        <span className={styles.timestamp}>{formatTime(message.createdAt)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AssistantMessage                                                    */
/* ------------------------------------------------------------------ */

interface AssistantMessageProps {
  message: SkuldChatMessage;
  onCopy?: (text: string) => void;
  onRegenerate?: (messageId: string) => void;
}

export function AssistantMessage({ message, onCopy, onRegenerate }: AssistantMessageProps) {
  const [copied, setCopied] = useState(false);
  const [thumbState, setThumbState] = useState<'up' | 'down' | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  const reasoningParts = (message.parts?.filter(p => p.type === 'reasoning') ?? []) as Array<{
    readonly type: 'reasoning';
    readonly text: string;
  }>;
  const hasReasoning = reasoningParts.length > 0 && reasoningParts.some(p => p.text.length > 0);

  const meta = message.metadata;
  const model = meta?.usage ? Object.keys(meta.usage)[0] : undefined;
  const tokens = meta?.usage ? extractTokens(meta.usage) : null;

  const handleCopy = useCallback(() => {
    const text = message.content;
    if (onCopy) {
      onCopy(text);
    } else {
      navigator.clipboard.writeText(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content, onCopy]);

  const handleRegenerate = useCallback(() => {
    onRegenerate?.(message.id);
  }, [message.id, onRegenerate]);

  const handleThumbUp = useCallback(() => {
    setThumbState(prev => (prev === 'up' ? null : 'up'));
  }, []);

  const handleThumbDown = useCallback(() => {
    setThumbState(prev => (prev === 'down' ? null : 'down'));
  }, []);

  return (
    <div className={styles.assistantWrapper}>
      <div className={styles.avatar}>
        <Hammer className={styles.avatarIcon} />
      </div>

      <div className={styles.assistantBody}>
        <div className={styles.assistantHeader}>
          {model && <span className={styles.modelBadge}>{model}</span>}
          <span className={styles.timestamp}>{formatTime(message.createdAt)}</span>
          {tokens && (
            <>
              <span className={styles.headerSeparator}>&middot;</span>
              <span className={styles.tokenInfo}>
                {tokens.input}&rarr;{tokens.output} tok
              </span>
            </>
          )}
        </div>

        {hasReasoning && (
          <div className={styles.reasoningSection}>
            <button
              type="button"
              className={styles.reasoningTrigger}
              onClick={() => setReasoningOpen(prev => !prev)}
            >
              {reasoningOpen ? (
                <ChevronDown className={styles.reasoningChevron} />
              ) : (
                <ChevronRight className={styles.reasoningChevron} />
              )}
              <Hammer className={styles.reasoningIcon} />
              <span className={styles.reasoningLabel}>Thinking</span>
            </button>
            {reasoningOpen && (
              <div className={styles.reasoningContent}>
                {reasoningParts.map((part, i) => (
                  <div key={i} className={styles.reasoningText}>
                    {part.text}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={styles.assistantContent}>
          {hasToolParts(message.parts) ? (
            <AssistantContentWithTools parts={message.parts!} fallbackContent={message.content} />
          ) : (
            <MarkdownContent content={message.content} />
          )}
        </div>

        <div className={styles.actionBar}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={handleCopy}
            title={copied ? 'Copied' : 'Copy'}
          >
            {copied ? (
              <Check className={styles.actionIcon} />
            ) : (
              <Copy className={styles.actionIcon} />
            )}
          </button>

          {onRegenerate && (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={handleRegenerate}
              title="Regenerate"
            >
              <RefreshCw className={styles.actionIcon} />
            </button>
          )}

          <div className={styles.actionDivider} />

          <button
            type="button"
            className={styles.actionBtn}
            data-active={thumbState === 'up'}
            onClick={handleThumbUp}
            title="Helpful"
          >
            <ThumbsUp className={styles.actionIcon} />
          </button>

          <button
            type="button"
            className={styles.actionBtn}
            data-active={thumbState === 'down'}
            onClick={handleThumbDown}
            title="Not helpful"
          >
            <ThumbsDown className={styles.actionIcon} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AssistantContentWithTools                                           */
/* ------------------------------------------------------------------ */

interface AssistantContentWithToolsProps {
  parts: readonly SkuldChatMessagePart[];
  fallbackContent: string;
}

function AssistantContentWithTools({ parts, fallbackContent }: AssistantContentWithToolsProps) {
  const blocks = partsToContentBlocks(parts);
  const grouped = groupContentBlocks(blocks);

  if (grouped.length === 0) {
    return <MarkdownContent content={fallbackContent} />;
  }

  return (
    <>
      {grouped.map((item, i) => {
        if (item.kind === 'text') {
          if (!item.text.trim()) return null;
          return <MarkdownContent key={i} content={item.text} />;
        }
        if (item.kind === 'single') {
          return <ToolBlock key={i} block={item.block} result={item.result} />;
        }
        if (item.kind === 'group') {
          return <ToolGroupBlock key={i} toolName={item.toolName} blocks={item.blocks} />;
        }
        return null;
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  StreamingMessage                                                    */
/* ------------------------------------------------------------------ */

interface StreamingMessageProps {
  content: string;
  parts?: readonly SkuldChatMessagePart[];
  model?: string;
}

export function StreamingMessage({ content, parts, model }: StreamingMessageProps) {
  // Show reasoning while thinking (before text content arrives)
  const reasoningParts = (parts?.filter(p => p.type === 'reasoning' && 'text' in p && p.text) ??
    []) as Array<{ readonly type: 'reasoning'; readonly text: string }>;
  const hasReasoning = reasoningParts.length > 0;
  const hasTools = hasToolParts(parts);

  // Reasoning arriving but no text yet — show reasoning inline
  if (!content && hasReasoning) {
    return (
      <div className={styles.streamingWrapper}>
        <div className={cn(styles.avatar, styles.avatarPulsing)}>
          <Hammer className={styles.avatarIcon} />
        </div>
        <div className={styles.assistantBody}>
          <div className={styles.assistantHeader}>
            {model && <span className={styles.modelBadge}>{model}</span>}
            <span className={styles.generatingLabel}>
              <Loader2 className={styles.spinnerIcon} />
              Thinking...
            </span>
          </div>
          <div className={styles.reasoningSection}>
            <div className={styles.reasoningContent}>
              {reasoningParts.map((part, i) => (
                <div key={i} className={styles.reasoningText}>
                  {part.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!content && !hasReasoning) {
    return (
      <div className={styles.streamingWrapper}>
        <div className={cn(styles.avatar, styles.avatarPulsing)}>
          <Hammer className={styles.avatarIcon} />
        </div>
        <div className={styles.assistantBody}>
          <div className={styles.assistantHeader}>
            {model && <span className={styles.modelBadge}>{model}</span>}
            <span className={styles.generatingLabel}>
              <Loader2 className={styles.spinnerIcon} />
              Thinking...
            </span>
          </div>
          <div className={styles.dotsContainer}>
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.thinkingLabel}>Thinking...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.streamingWrapper}>
      <div className={cn(styles.avatar, styles.avatarPulsing)}>
        <Hammer className={styles.avatarIcon} />
      </div>
      <div className={styles.assistantBody}>
        <div className={styles.assistantHeader}>
          {model && <span className={styles.modelBadge}>{model}</span>}
          <span className={styles.generatingLabel}>
            <Loader2 className={styles.spinnerIcon} />
            Generating...
          </span>
        </div>
        <div className={styles.assistantContent}>
          {hasTools && parts ? (
            <AssistantContentWithTools parts={parts} fallbackContent={content} />
          ) : (
            <MarkdownContent content={content} isStreaming />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SystemMessage                                                      */
/* ------------------------------------------------------------------ */

interface SystemMessageProps {
  message: SkuldChatMessage;
}

export function SystemMessage({ message }: SystemMessageProps) {
  return (
    <div className={styles.systemMessage}>
      <Terminal className={styles.systemIcon} />
      <span>{message.content}</span>
    </div>
  );
}
