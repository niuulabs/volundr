import { useState, useEffect, useRef } from 'react';
import { OdinEye } from '@/components/atoms/OdinEye';
import { cn } from '@/utils';
import styles from './SessionStartingIndicator.module.css';

export interface SessionStartingIndicatorProps {
  /** Additional CSS class */
  className?: string;
}

/**
 * Forge-themed status messages shown while a Völundr session is starting.
 *
 * Each message cycles with a fade transition to keep the user informed
 * that the session is being provisioned.
 */
const FORGE_MESSAGES = [
  'Igniting the forge fires…',
  'Summoning the Skuld pod…',
  'Shaping the workspace…',
  'Tempering the environment…',
  'Forging your session…',
  'Preparing the anvil…',
  'Stoking the bellows…',
  'Quenching the tools…',
  'Aligning the runes…',
  'Awakening the smith…',
];

/** How long each message stays visible (ms) */
const MESSAGE_DISPLAY_DURATION = 3500;

/**
 * Animated loading indicator displayed in tab panels while a session
 * is in the 'starting' state. Shows Odin's Eye with a pulsing glow
 * and cycling forge-themed status messages.
 */
export function SessionStartingIndicator({ className }: SessionStartingIndicatorProps) {
  const [messageIndex, setMessageIndex] = useState(() =>
    Math.floor(Math.random() * FORGE_MESSAGES.length)
  );
  const [fading, setFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cycle = () => {
      setFading(true);

      timerRef.current = setTimeout(() => {
        setMessageIndex(prev => (prev + 1) % FORGE_MESSAGES.length);
        setFading(false);
      }, 400);
    };

    const interval = setInterval(cycle, MESSAGE_DISPLAY_DURATION);

    return () => {
      clearInterval(interval);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div className={cn(styles.container, className)}>
      <div className={styles.eyeWrapper}>
        <OdinEye size={40} className={styles.eye} />
      </div>
      <span className={styles.label}>Forging session…</span>
      <span className={cn(styles.message, fading && styles.messageFading)}>
        {FORGE_MESSAGES[messageIndex]}
      </span>
    </div>
  );
}
