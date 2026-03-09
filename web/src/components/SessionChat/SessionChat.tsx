import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { Wifi, WifiOff, BrainCircuitIcon, RotateCcwIcon } from 'lucide-react';
import { PermissionStack } from '@/components/PermissionDialog';
import { useSkuldChat } from '@/hooks/useSkuldChat';
import type { PermissionBehavior } from '@/hooks/useSkuldChat';
import { cn } from '@/utils';
import { UserMessage, AssistantMessage, StreamingMessage, SystemMessage } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { SessionEmptyChat } from './ChatEmptyStates';
import styles from './SessionChat.module.css';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages or streaming updates
  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isRunning]);

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
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage]
  );

  const handleStop = useCallback(() => {
    sendInterrupt();
  }, [sendInterrupt]);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text);
  }, []);

  const handleRegenerate = useCallback(
    (messageId: string) => {
      // Find the user message that preceded this assistant message
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

  // Show welcome when only system messages exist (no real user/assistant conversation)
  const hasConversation = useMemo(
    () =>
      messages.some(m => m.role === 'user' || (m.role === 'assistant' && !m.metadata?.messageType)),
    [messages]
  );

  // Filter system messages to render inline, separate from main flow
  const visibleMessages = useMemo(
    () => messages.filter(m => m.role === 'user' || m.role === 'assistant'),
    [messages]
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
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>
      ) : (
        <SessionEmptyChat sessionName="Volundr" onSuggestionClick={handleSend} />
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
