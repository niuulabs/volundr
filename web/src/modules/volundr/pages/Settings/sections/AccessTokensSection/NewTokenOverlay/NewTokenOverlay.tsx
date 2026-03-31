import { useState, useCallback } from 'react';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import styles from './NewTokenOverlay.module.css';

const COPY_FEEDBACK_DURATION_MS = 2000;

interface NewTokenOverlayProps {
  token: string;
  onDone: () => void;
}

export function NewTokenOverlay({ token, onDone }: NewTokenOverlayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
  }, [token]);

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <AlertTriangle className={styles.warningIcon} />
          <h3 className={styles.title}>Token Created</h3>
        </div>

        <div className={styles.body}>
          <p className={styles.warning}>Copy this token now. It will not be shown again.</p>

          <div className={styles.tokenBox}>
            <code className={styles.tokenValue}>{token}</code>
            <button
              className={styles.copyButton}
              onClick={handleCopy}
              type="button"
              aria-label="Copy token"
            >
              {copied ? (
                <Check className={styles.copyIcon} />
              ) : (
                <Copy className={styles.copyIcon} />
              )}
            </button>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.doneButton} onClick={onDone} type="button">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
