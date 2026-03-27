import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { Wifi, WifiOff, BrainCircuitIcon, RotateCcwIcon, ArrowDownIcon } from 'lucide-react';
import { PermissionStack } from '@/modules/shared/components/PermissionDialog';
import { useSkuldChat } from '@/modules/shared/hooks/useSkuldChat';
import type {
  PermissionBehavior,
  ContentBlock,
  AttachmentMeta,
} from '@/modules/shared/hooks/useSkuldChat';
import { cn } from '@/utils';
import { UserMessage, AssistantMessage, StreamingMessage, SystemMessage } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { SessionEmptyChat } from './ChatEmptyStates';
import type { FileAttachment } from './useFileAttachments';
import styles from './SessionChat.module.css';

const SCROLL_THRESHOLD = 150;
const SCROLL_LOCK_MS = 500;

interface SessionChatProps {
  /** WebSocket URL for the chat — e.g. wss://host/session */
  url: string | null;
  /** Optional class name for the outer wrapper */
  className?: string;
  /** Called when the visible message count changes */
  onMessageCountChange?: (count: number) => void;
  /** Skuld pod hostname for direct API calls (file listing, etc.) */
  sessionHost?: string | null;
  /** Full chat endpoint URL for gateway-routed sessions */
  chatEndpoint?: string | null;
}

const THINKING_PRESETS = [
  { label: '4K', value: 4096 },
  { label: '8K', value: 8192 },
  { label: '16K', value: 16384 },
  { label: '32K', value: 32768 },
] as const;

export function SessionChat({
  url,
  className,
  onMessageCountChange,
  sessionHost = null,
  chatEndpoint = null,
}: SessionChatProps) {
  const {
    messages,
    connected,
    isRunning,
    historyLoaded,
    pendingPermissions,
    sendMessage,
    respondToPermission,
    sendInterrupt,
    sendSetModel,
    sendSetMaxThinkingTokens,
    sendRewindFiles,
    availableCommands,
  } = useSkuldChat(url);

  const [modelInput, setModelInput] = useState('');
  const [showModelInput, setShowModelInput] = useState(false);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const userSentRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const scrollLockUntilRef = useRef(0);

  // Show welcome when only system messages exist (no real user/assistant conversation)
  const hasConversation = useMemo(
    () =>
      messages.some(m => m.role === 'user' || (m.role === 'assistant' && !m.metadata?.messageType)),
    [messages]
  );

  // Filter system messages to render inline, separate from main flow
  const visibleMessages = useMemo(
    () =>
      messages.filter(m => {
        if (m.role === 'system') return false;
        if (m.role === 'assistant' && m.status === 'complete' && !m.content.trim()) return false;
        return true;
      }),
    [messages]
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView?.({ behavior });
    setNewMessageCount(0);
  }, []);

  // Track scroll position with passive listener
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      isNearBottomRef.current = distanceFromBottom <= SCROLL_THRESHOLD;
      setShowScrollBtn(distanceFromBottom > SCROLL_THRESHOLD * 2);

      if (isNearBottomRef.current) {
        setNewMessageCount(0);
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });

    // Watch for content height changes (code block expand/collapse, image load)
    // and suppress auto-scroll briefly so the viewport doesn't jump
    let prevHeight = el.scrollHeight;
    const resizeObserver = new ResizeObserver(() => {
      const newHeight = el.scrollHeight;
      if (newHeight !== prevHeight) {
        prevHeight = newHeight;
        scrollLockUntilRef.current = Date.now() + SCROLL_LOCK_MS;
      }
    });
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
    };
  }, [hasConversation]);

  // Auto-scroll only on new messages or user send — never on DOM resize
  useEffect(() => {
    const messageCount = visibleMessages.length;
    const countDelta = messageCount - prevMessageCountRef.current;
    prevMessageCountRef.current = messageCount;

    // User just sent a message — always scroll
    if (userSentRef.current) {
      userSentRef.current = false;
      messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
      return;
    }

    // No new messages — don't scroll (prevents scroll on code block expand)
    if (countDelta === 0) return;

    // Scroll lock active (code block expand/collapse just happened)
    if (Date.now() < scrollLockUntilRef.current) return;

    // New messages arrived while near bottom — auto-scroll
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
      return;
    }

    // User is scrolled up — show count of new messages
    setNewMessageCount(prev => prev + countDelta);
  }, [visibleMessages.length]);

  const handlePermissionRespond = useCallback(
    (requestId: string, behavior: PermissionBehavior) => {
      respondToPermission(requestId, behavior);
    },
    [respondToPermission]
  );

  const handleModelSubmit = useCallback(() => {
    const trimmed = modelInput.trim();
    if (!trimmed) {
      return;
    }
    sendSetModel(trimmed);
    setModelInput('');
    setShowModelInput(false);
  }, [modelInput, sendSetModel]);

  const handleThinkingSelect = useCallback(
    (tokens: number) => {
      sendSetMaxThinkingTokens(tokens);
      setShowThinkingMenu(false);
    },
    [sendSetMaxThinkingTokens]
  );

  const handleSend = useCallback(
    (text: string, fileAttachments: FileAttachment[]) => {
      userSentRef.current = true;

      // Only image files with compressed blobs can be transmitted as content blocks.
      // Non-image files are filtered out so metadata stays consistent with actual
      // content blocks sent over the wire.
      const imageAttachments = fileAttachments.filter(
        (fa): fa is FileAttachment & { compressed: Blob } =>
          fa.file.type.startsWith('image/') && fa.compressed !== null
      );

      if (imageAttachments.length === 0) {
        sendMessage(text);
        return;
      }

      const attachmentMeta: AttachmentMeta[] = imageAttachments.map(fa => ({
        name: fa.name,
        type: 'image' as const,
        size: fa.compressed.size,
        contentType: 'image/jpeg',
      }));

      // Pre-allocate to preserve ordering: contentBlocks[i] matches attachmentMeta[i]
      const contentBlocks: (ContentBlock | null)[] = new Array(imageAttachments.length).fill(null);
      let processedCount = 0;

      const checkComplete = () => {
        processedCount += 1;
        if (processedCount < imageAttachments.length) return;
        // Filter out failed reads, keep meta in sync
        const finalBlocks: ContentBlock[] = [];
        const finalMeta: AttachmentMeta[] = [];
        for (let i = 0; i < contentBlocks.length; i++) {
          const block = contentBlocks[i];
          if (block) {
            finalBlocks.push(block);
            finalMeta.push(attachmentMeta[i]);
          }
        }
        sendMessage(text, finalBlocks, finalMeta);
      };

      imageAttachments.forEach((fa, index) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          contentBlocks[index] = {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64,
            },
          };
          checkComplete();
        };
        reader.onerror = () => {
          // Skip failed image but still send the message
          checkComplete();
        };
        reader.readAsDataURL(fa.compressed);
      });
    },
    [sendMessage]
  );

  const handleStop = useCallback(() => {
    sendInterrupt();
  }, [sendInterrupt]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text);
  }, []);

  const handleBookmark = useCallback((id: string, bookmarked: boolean) => {
    const key = `bookmark:${id}`;
    if (bookmarked) {
      localStorage.setItem(key, '1');
    } else {
      localStorage.removeItem(key);
    }
  }, []);

  const handleRegenerate = useCallback(
    (messageId: string) => {
      const idx = messages.findIndex(m => m.id === messageId);
      if (idx < 0) {
        return;
      }
      for (let i = idx - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          sendMessage(messages[i].content);
          return;
        }
      }
    },
    [messages, sendMessage]
  );

  // Report visible message count to parent for sidebar sync
  useEffect(() => {
    onMessageCountChange?.(visibleMessages.length);
  }, [visibleMessages.length, onMessageCountChange]);

  return (
    <div className={cn(styles.wrapper, className)}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.statusIndicator} data-connected={connected}>
            {connected ? (
              <Wifi className={styles.statusIcon} />
            ) : (
              <WifiOff className={styles.statusIcon} />
            )}
            <span>{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <span className={styles.messageCount}>
            {visibleMessages.length} message{visibleMessages.length !== 1 ? 's' : ''}
          </span>
        </div>

        {connected && (
          <div className={styles.toolbarRight}>
            <div className={styles.controlGroup}>
              <button
                type="button"
                className={styles.controlBtn}
                onClick={() => setShowModelInput(prev => !prev)}
                title="Switch model"
                data-testid="model-switch-toggle"
              >
                <BrainCircuitIcon className={styles.controlIcon} />
              </button>

              <div className={styles.thinkingWrapper}>
                <button
                  type="button"
                  className={styles.controlBtn}
                  onClick={() => setShowThinkingMenu(prev => !prev)}
                  title="Set thinking budget"
                  data-testid="thinking-budget-toggle"
                >
                  <span className={styles.controlLabel}>Thinking</span>
                </button>
                {showThinkingMenu && (
                  <div className={styles.thinkingMenu} data-testid="thinking-menu">
                    {THINKING_PRESETS.map(preset => (
                      <button
                        key={preset.value}
                        type="button"
                        className={styles.thinkingOption}
                        onClick={() => handleThinkingSelect(preset.value)}
                        data-testid={`thinking-${preset.label}`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                className={styles.controlBtn}
                onClick={sendRewindFiles}
                title="Rewind files"
                data-testid="rewind-files"
              >
                <RotateCcwIcon className={styles.controlIcon} />
              </button>
            </div>
          </div>
        )}
      </div>

      {showModelInput && connected && (
        <div className={styles.modelInputBar} data-testid="model-input-bar">
          <input
            type="text"
            className={styles.modelInput}
            value={modelInput}
            onChange={e => setModelInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleModelSubmit();
              if (e.key === 'Escape') setShowModelInput(false);
            }}
            placeholder="Model ID (e.g. claude-opus-4-6)"
            autoFocus
            aria-label="Model ID input"
          />
          <button
            type="button"
            className={styles.modelSubmitBtn}
            onClick={handleModelSubmit}
            data-testid="model-submit"
          >
            Switch
          </button>
        </div>
      )}

      {!historyLoaded && connected && (
        <div className={styles.historyLoading} data-testid="history-loading">
          Loading conversation...
        </div>
      )}

      {hasConversation ? (
        <div className={styles.messagesContainer} ref={scrollContainerRef}>
          <div className={styles.messagesInner}>
            {visibleMessages.map(msg => {
              // System messages rendered as compact inline notifications
              if (msg.metadata?.messageType === 'system') {
                return <SystemMessage key={msg.id} message={msg} />;
              }

              if (msg.role === 'user') {
                return <UserMessage key={msg.id} message={msg} />;
              }

              // Streaming assistant message
              if (msg.status === 'running') {
                return (
                  <StreamingMessage
                    key={msg.id}
                    content={msg.content}
                    parts={msg.parts}
                    model={msg.metadata?.messageType !== 'system' ? undefined : undefined}
                  />
                );
              }

              // Complete assistant message
              return (
                <AssistantMessage
                  key={msg.id}
                  message={msg}
                  onCopy={handleCopy}
                  onRegenerate={handleRegenerate}
                  onBookmark={handleBookmark}
                  bookmarked={localStorage.getItem(`bookmark:${msg.id}`) === '1'}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>
          {showScrollBtn && (
            <button
              type="button"
              className={styles.scrollToBottom}
              onClick={() => scrollToBottom('smooth')}
              aria-label="Scroll to bottom"
            >
              <ArrowDownIcon className={styles.scrollToBottomIcon} />
              {newMessageCount > 0 && (
                <span className={styles.scrollToBottomBadge}>
                  {newMessageCount > 99 ? '99+' : newMessageCount}
                </span>
              )}
            </button>
          )}
        </div>
      ) : (
        <SessionEmptyChat sessionName="Volundr" onSuggestionClick={text => handleSend(text, [])} />
      )}

      <div className={styles.inputArea}>
        <div className={styles.inputInner}>
          {pendingPermissions.length > 0 && (
            <PermissionStack permissions={pendingPermissions} onRespond={handlePermissionRespond} />
          )}
          <ChatInput
            onSend={handleSend}
            isLoading={isRunning}
            onStop={handleStop}
            disabled={!connected}
            sessionHost={sessionHost}
            chatEndpoint={chatEndpoint}
            availableCommands={availableCommands}
          />
        </div>
      </div>
    </div>
  );
}
