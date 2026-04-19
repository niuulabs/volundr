import { cn } from '../../utils/cn';
import './LifecycleBadge.css';

/**
 * Session lifecycle states from the Völundr session forge.
 *
 * Follows the canonical transition order:
 * requested → provisioning → ready → running → idle → terminating → terminated
 * Any state can fail → failed.
 */
export type LifecycleState =
  | 'requested'
  | 'provisioning'
  | 'ready'
  | 'running'
  | 'idle'
  | 'terminating'
  | 'terminated'
  | 'failed';

interface StateConfig {
  label: string;
  pulse: boolean;
}

const STATE_CONFIG: Record<LifecycleState, StateConfig> = {
  requested: { label: 'requested', pulse: false },
  provisioning: { label: 'provisioning', pulse: true },
  ready: { label: 'ready', pulse: false },
  running: { label: 'running', pulse: true },
  idle: { label: 'idle', pulse: false },
  terminating: { label: 'terminating', pulse: true },
  terminated: { label: 'terminated', pulse: false },
  failed: { label: 'failed', pulse: false },
};

export interface LifecycleBadgeProps {
  state: LifecycleState;
  className?: string;
}

/**
 * LifecycleBadge — session state pill with a colored status dot.
 *
 * States and their visual treatment:
 * - `provisioning` → muted + pulsing dot
 * - `ready` → ok (green)
 * - `running` → brand + pulsing dot
 * - `idle` → muted
 * - `terminating` → warn + pulsing dot
 * - `terminated` → faint
 * - `failed` → critical (red)
 * - `requested` → queued
 *
 * @example
 * <LifecycleBadge state="running" />
 */
export function LifecycleBadge({ state, className }: LifecycleBadgeProps) {
  const config = STATE_CONFIG[state];

  return (
    <span
      className={cn(
        'niuu-lifecycle-badge',
        `niuu-lifecycle-badge--${state}`,
        config.pulse && 'niuu-lifecycle-badge--pulse',
        className,
      )}
      aria-label={`session state: ${config.label}`}
    >
      <span className="niuu-lifecycle-badge__dot" aria-hidden />
      <span className="niuu-lifecycle-badge__label">{config.label}</span>
    </span>
  );
}
