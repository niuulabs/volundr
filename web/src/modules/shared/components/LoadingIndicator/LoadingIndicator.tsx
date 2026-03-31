import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/modules/shared/utils/classnames';
import styles from './LoadingIndicator.module.css';

export interface LoadingIndicatorProps {
  /** Messages to cycle through */
  messages: string[];
  /** Optional icon element (e.g. <OdinEye />) */
  icon?: ReactNode;
  /** Optional static label above messages (centered variant only) */
  label?: string;
  /** Layout variant */
  variant?: 'inline' | 'centered';
  /** How long each message stays visible (ms) */
  displayDuration?: number;
  /** Additional CSS class */
  className?: string;
}

/** Default display duration in milliseconds */
const DEFAULT_DISPLAY_DURATION = 3500;

/** Fade transition duration matching CSS (ms) */
const FADE_DURATION = 400;

export function LoadingIndicator({
  messages,
  icon,
  label,
  variant = 'inline',
  displayDuration = DEFAULT_DISPLAY_DURATION,
  className,
}: LoadingIndicatorProps) {
  const [messageIndex, setMessageIndex] = useState(() =>
    Math.floor(Math.random() * messages.length)
  );
  const [fading, setFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (messages.length <= 1) {
      return;
    }

    const cycle = () => {
      setFading(true);

      timerRef.current = setTimeout(() => {
        setMessageIndex(prev => (prev + 1) % messages.length);
        setFading(false);
      }, FADE_DURATION);
    };

    const interval = setInterval(cycle, displayDuration);

    return () => {
      clearInterval(interval);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [messages.length, displayDuration]);

  if (variant === 'centered') {
    return (
      <div className={cn(styles.centered, className)}>
        {icon && <div className={styles.iconWrapper}>{icon}</div>}
        {label && <span className={styles.label}>{label}</span>}
        <span className={cn(styles.message, fading && styles.messageFading)}>
          {messages[messageIndex]}
        </span>
      </div>
    );
  }

  return (
    <div className={cn(styles.inline, className)}>
      {icon && <div className={styles.inlineIcon}>{icon}</div>}
      <span className={cn(styles.message, fading && styles.messageFading)}>
        {messages[messageIndex]}
      </span>
    </div>
  );
}
