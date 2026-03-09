import { cn } from '@/utils';
import styles from './OdinEye.module.css';

export interface OdinEyeProps {
  /** Size in pixels */
  size?: number;
  /** Additional CSS class */
  className?: string;
}

/**
 * Odin's single eye — a stylized almond-shaped eye with a blink animation.
 * Used as a loading/thinking indicator throughout the ODIN dashboard.
 */
export function OdinEye({ size = 32, className }: OdinEyeProps) {
  return (
    <span className={cn(styles.container, className)}>
      <svg
        className={styles.eye}
        viewBox="0 0 40 24"
        fill="none"
        width={size}
        height={size * 0.6}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Outer eye shape — almond with pointed ends */}
        <path
          className={styles.eyeOutline}
          d="M2 12C2 12 10 3 20 3C30 3 38 12 38 12C38 12 30 21 20 21C10 21 2 12 2 12Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />

        {/* Iris glow */}
        <circle
          className={styles.irisGlow}
          cx="20"
          cy="12"
          r="6"
          fill="currentColor"
          opacity="0.15"
        />

        {/* Iris ring */}
        <circle
          className={styles.iris}
          cx="20"
          cy="12"
          r="5"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        />

        {/* Pupil */}
        <circle className={styles.pupil} cx="20" cy="12" r="2.2" fill="currentColor" />

        {/* Highlight */}
        <circle cx="17.5" cy="10" r="1" fill="currentColor" opacity="0.6" />

        {/* Eyelid (closes over the eye during blink) */}
        <path
          className={styles.eyelid}
          d="M2 12C2 12 10 3 20 3C30 3 38 12 38 12"
          stroke="none"
          fill="var(--odin-eye-bg, var(--color-bg-primary, #09090b))"
        />
      </svg>
    </span>
  );
}
