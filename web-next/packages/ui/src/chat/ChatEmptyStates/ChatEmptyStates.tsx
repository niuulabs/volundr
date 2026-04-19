import { Hammer } from 'lucide-react';
import styles from './ChatEmptyStates.module.css';

interface SessionEmptyChatProps {
  sessionName: string;
  onSuggestionClick: (text: string) => void;
}

const SUGGESTIONS = [
  'Review the code and suggest improvements',
  'Run the test suite and fix failures',
  'Explain the architecture of this module',
] as const;

export function SessionEmptyChat({ sessionName, onSuggestionClick }: SessionEmptyChatProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.inner}>
        <div className={styles.iconBox}>
          <Hammer className={styles.icon} />
        </div>
        <div className={styles.title}>{sessionName}</div>
        <div className={styles.subtitle}>
          Start working — ask a question or give an instruction.
        </div>
        <div className={styles.suggestions}>
          {SUGGESTIONS.map(text => (
            <button
              key={text}
              type="button"
              className={styles.suggestion}
              onClick={() => onSuggestionClick(text)}
            >
              {text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
