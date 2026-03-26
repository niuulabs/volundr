import { useState, useRef, useEffect } from 'react';
import type { PlanningMessage } from '../../models/planning';
import styles from './ChatPanel.module.css';

interface ChatPanelProps {
  messages: PlanningMessage[];
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function ChatPanel({ messages, onSend, disabled = false }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
  };

  return (
    <div className={styles.panel}>
      <div className={styles.messages}>
        {messages.length === 0 && (
          <div className={styles.empty}>
            Start the conversation to refine your saga decomposition.
          </div>
        )}
        {messages.map(msg => (
          <div
            key={msg.id}
            className={styles.message}
            data-sender={msg.sender}
          >
            <span className={styles.sender}>{msg.sender}</span>
            <p className={styles.content}>{msg.content}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form className={styles.inputArea} onSubmit={handleSubmit}>
        <input
          type="text"
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Discuss the decomposition..."
          disabled={disabled}
        />
        <button
          type="submit"
          className={styles.sendButton}
          disabled={disabled || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
