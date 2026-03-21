import { useState, useEffect, useRef } from 'react';
import { OdinEye } from '@/modules/volundr/components/atoms/OdinEye';
import { cn } from '@/utils';
import styles from './ChatLoadingIndicator.module.css';

export interface ChatLoadingIndicatorProps {
  /** Additional CSS class */
  className?: string;
}

/**
 * Viking facts shown while waiting for a response from a Völundr session.
 *
 * Each fact is short enough to read in a few seconds before the next one
 * fades in, keeping the user entertained while Odin thinks.
 */
const VIKING_FACTS = [
  'Odin sacrificed his eye for wisdom',
  'Vikings never wore horned helmets',
  'Bluetooth is named after King Harald',
  'Thursday means "Thor\'s day"',
  'Wednesday means "Woden\'s day"',
  'Friday means "Freyja\'s day"',
  'Hugin & Munin: thought and memory',
  'Yggdrasil connects the nine realms',
  'Berserkers fought in a trance',
  'Runes were carved, never written',
  'Vikings used sunstones to navigate',
  'Shield-maidens fought alongside men',
  'Mead was the drink of the gods',
  'Skalds were viking warrior-poets',
  'Drakkars had dragon-headed prows',
  'Loki could shapeshift at will',
  'Mjölnir could level mountains',
  'Fenrir the wolf swallows Odin',
  'Valkyries choose the worthy slain',
  'Ragnarök: twilight of the gods',
  'Norse sailors reached Baghdad',
  'Viking funerals burned at sea',
  'Leif Erikson found America first',
  'Ratatoskr carries insults up the world tree',
  'Odin hung nine days on Yggdrasil',
  'Sleipnir had eight legs',
  'Tyr lost his hand to Fenrir',
  'Dwarves forged the finest weapons',
  'Jörmungandr encircles all of Midgard',
  'The Norns weave every fate',
];

/** How long each fact stays visible (ms) */
const FACT_DISPLAY_DURATION = 3500;

/**
 * A loading indicator for the chat panel.
 *
 * Displays Odin's blinking eye alongside cycling viking facts to keep
 * users engaged while waiting for a session to respond.
 */
export function ChatLoadingIndicator({ className }: ChatLoadingIndicatorProps) {
  const [factIndex, setFactIndex] = useState(() => Math.floor(Math.random() * VIKING_FACTS.length));
  const [fading, setFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cycle = () => {
      // Start fade-out
      setFading(true);

      timerRef.current = setTimeout(() => {
        // Swap text while invisible, then fade in
        setFactIndex(prev => (prev + 1) % VIKING_FACTS.length);
        setFading(false);
      }, 400); // matches CSS transition duration
    };

    const interval = setInterval(cycle, FACT_DISPLAY_DURATION);

    return () => {
      clearInterval(interval);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return (
    <div className={cn(styles.container, className)}>
      <OdinEye size={28} className={styles.eye} />
      <span className={cn(styles.fact, fading && styles.factFading)}>
        {VIKING_FACTS[factIndex]}
      </span>
    </div>
  );
}
