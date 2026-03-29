import { useState, useRef, useEffect } from 'react';
import type { RaidMessage } from '../../hooks';
import styles from './FeedbackChat.module.css';

interface FeedbackChatProps {
  messages: RaidMessage[];
  onSend: (content: string) => Promise<void>;
  loading: boolean;
}

function senderRole(sender: string): 'reviewer' | 'human' | 'session' {
  if (sender === 'reviewer') return 'reviewer';
  if (sender === 'user' || sender === 'human') return 'human';
  return 'session';
}

function senderLabel(role: 'reviewer' | 'human' | 'session'): string {
  if (role === 'reviewer') return 'Reviewer (auto)';
  if (role === 'human') return 'You';
  return 'Session';
}

export function FeedbackChat({ messages, onSend, loading }: FeedbackChatProps) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages.length]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setInput('');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className={styles.chat}>
      <div className={styles.messages} ref={scrollRef}>
        {loading && messages.length === 0 && (
          <div className={styles.empty}>Loading messages...</div>
        )}
        {messages.map(msg => {
          const role = senderRole(msg.sender);
          return (
            <div key={msg.id} className={styles.bubble} data-role={role}>
              <div className={styles.who} data-role={role}>
                {senderLabel(role)}
              </div>
              {msg.content}
            </div>
          );
        })}
      </div>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          placeholder="Send message to session..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
        />
        <button className={styles.send} onClick={handleSend} disabled={sending || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
