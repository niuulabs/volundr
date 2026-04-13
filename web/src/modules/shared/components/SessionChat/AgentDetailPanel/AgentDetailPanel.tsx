import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Wifi, WifiOff, ArrowDownIcon } from 'lucide-react';
import type { ParticipantMeta } from '@/modules/shared/hooks/useSkuldChat';
import { useAgentDetail } from '@/modules/shared/hooks/useAgentDetail';
import { AssistantMessage, StreamingMessage, SystemMessage, UserMessage } from '../ChatMessages';
import styles from './AgentDetailPanel.module.css';

const SCROLL_THRESHOLD = 150;

const COLOR_MAP: Record<string, string> = {
  amber: 'var(--color-accent-amber)',
  cyan: 'var(--color-accent-cyan)',
  emerald: 'var(--color-accent-emerald)',
  purple: 'var(--color-accent-purple)',
  red: 'var(--color-accent-red)',
  indigo: 'var(--color-accent-indigo)',
  orange: 'var(--color-accent-orange)',
};

function resolveColor(color: string): string {
  return COLOR_MAP[color] ?? 'var(--color-text-secondary)';
}

interface AgentDetailPanelProps {
  /** The participant whose event stream should be shown */
  participant: ParticipantMeta;
  /** Called when the close button is pressed or Escape is pressed */
  onClose: () => void;
}

/**
 * Slide-out right panel that displays the full event stream (thinking blocks,
 * tool calls, streaming messages) for a single Ravn agent.
 *
 * Connects to the agent's gateway WebSocket via `useAgentDetail` and renders
 * using the same shared message components as the main chat pane.
 */
export function AgentDetailPanel({ participant, onClose }: AgentDetailPanelProps) {
  const { messages, connected, isRunning } = useAgentDetail(participant.gatewayUrl ?? null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const accentColor = resolveColor(participant.color);

  // Determine activity status label
  const activityStatus = isRunning ? 'active' : 'idle';

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView?.({ behavior });
    setNewCount(0);
  }, []);

  // Track scroll position
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      isNearBottomRef.current = dist <= SCROLL_THRESHOLD;
      setShowScrollBtn(dist > SCROLL_THRESHOLD * 2);
      if (isNearBottomRef.current) setNewCount(0);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    const count = messages.length;
    const delta = count - prevCountRef.current;
    prevCountRef.current = count;

    if (delta === 0) return;

    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
      return;
    }

    setNewCount(prev => prev + delta);
  }, [messages.length]);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const visibleMessages = messages.filter(m => {
    if (m.role === 'system') return false;
    if (m.role === 'assistant' && m.status === 'complete' && !m.content.trim()) return false;
    return true;
  });

  return (
    <div className={styles.panel} data-testid="agent-detail-panel">
      {/* ── Header ── */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span
            className={styles.personaDot}
            style={{ '--agent-color': accentColor } as React.CSSProperties}
          />
          <span
            className={styles.personaName}
            style={{ '--agent-color': accentColor } as React.CSSProperties}
            data-testid="agent-persona-name"
          >
            {participant.persona}
          </span>
        </div>

        <div className={styles.headerRight}>
          <div className={styles.statusIndicator} data-connected={connected}>
            {connected ? (
              <Wifi className={styles.statusIcon} />
            ) : (
              <WifiOff className={styles.statusIcon} />
            )}
          </div>

          <span
            className={styles.activityBadge}
            data-status={activityStatus}
            data-testid="agent-activity-status"
          >
            {isRunning ? 'thinking' : 'idle'}
          </span>

          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close agent detail panel"
            data-testid="agent-detail-close"
          >
            <X className={styles.closeIcon} />
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className={styles.messagesContainer} ref={scrollContainerRef}>
        <div className={styles.messagesInner}>
          {visibleMessages.length === 0 ? (
            <div className={styles.emptyState} data-testid="agent-detail-empty">
              {connected ? 'Waiting for agent activity…' : 'Connecting to agent…'}
            </div>
          ) : (
            visibleMessages.map(msg => {
              if (msg.metadata?.messageType === 'system') {
                return <SystemMessage key={msg.id} message={msg} />;
              }

              if (msg.role === 'user') {
                return <UserMessage key={msg.id} message={msg} />;
              }

              if (msg.status === 'running') {
                return <StreamingMessage key={msg.id} content={msg.content} parts={msg.parts} />;
              }

              return <AssistantMessage key={msg.id} message={msg} />;
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {showScrollBtn && (
          <button
            type="button"
            className={styles.scrollToBottom}
            onClick={() => scrollToBottom('smooth')}
            aria-label="Scroll to bottom"
          >
            <ArrowDownIcon className={styles.scrollIcon} />
            {newCount > 0 && (
              <span className={styles.scrollBadge}>{newCount > 99 ? '99+' : newCount}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
