import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/utils';
import styles from './TerminalAccessoryBar.module.css';

const CTRL_AUTO_DEACTIVATE_MS = 3000;

interface KeyDef {
  label: string;
  value: string;
  isCtrl?: boolean;
}

const KEYS: (KeyDef | 'separator')[] = [
  { label: 'Esc', value: '\x1b' },
  { label: 'Tab', value: '\t' },
  'separator',
  { label: 'Ctrl', value: '', isCtrl: true },
  { label: '^C', value: '\x03' },
  { label: '^D', value: '\x04' },
  { label: '^Z', value: '\x1a' },
  { label: '^L', value: '\x0c' },
  'separator',
  { label: '\u2191', value: '\x1b[A' },
  { label: '\u2193', value: '\x1b[B' },
  { label: '\u2190', value: '\x1b[D' },
  { label: '\u2192', value: '\x1b[C' },
  'separator',
  { label: '|', value: '|' },
  { label: '~', value: '~' },
  { label: '-', value: '-' },
  { label: '/', value: '/' },
];

export interface TerminalAccessoryBarProps {
  onInput: (data: string) => void;
  className?: string;
}

export function TerminalAccessoryBar({ onInput, className }: TerminalAccessoryBarProps) {
  const [ctrlActive, setCtrlActive] = useState(false);
  const ctrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCtrlTimer = useCallback(() => {
    if (ctrlTimerRef.current !== null) {
      clearTimeout(ctrlTimerRef.current);
      ctrlTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearCtrlTimer();
  }, [clearCtrlTimer]);

  const handleKeyPress = useCallback(
    (key: KeyDef) => {
      if (key.isCtrl) {
        setCtrlActive(prev => {
          if (prev) {
            clearCtrlTimer();
            return false;
          }
          ctrlTimerRef.current = setTimeout(() => {
            setCtrlActive(false);
          }, CTRL_AUTO_DEACTIVATE_MS);
          return true;
        });
        return;
      }

      if (ctrlActive && key.value.length === 1) {
        // Send Ctrl+key (ASCII code = char code - 64 for uppercase)
        const code = key.value.toUpperCase().charCodeAt(0) - 64;
        if (code > 0 && code < 32) {
          onInput(String.fromCharCode(code));
        } else {
          onInput(key.value);
        }
        setCtrlActive(false);
        clearCtrlTimer();
        return;
      }

      onInput(key.value);
    },
    [ctrlActive, onInput, clearCtrlTimer]
  );

  const preventFocusSteal = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div
      className={cn(styles.accessoryBar, className)}
      onMouseDown={preventFocusSteal}
      onTouchStart={preventFocusSteal}
    >
      {KEYS.map((key, idx) => {
        if (key === 'separator') {
          return <div key={`sep-${idx}`} className={styles.separator} />;
        }

        return (
          <button
            key={key.label}
            className={cn(styles.key, key.isCtrl && styles.ctrlKey)}
            data-active={key.isCtrl ? ctrlActive : undefined}
            onClick={() => handleKeyPress(key)}
            onMouseDown={preventFocusSteal}
            onTouchStart={preventFocusSteal}
            tabIndex={-1}
          >
            {key.label}
          </button>
        );
      })}
    </div>
  );
}
