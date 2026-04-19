import type { PersonaRole } from '@niuulabs/domain';
import { cn } from '../../utils/cn';
import type { DotState } from '../../primitives/StateDot/StateDot';
import { StateDot } from '../../primitives/StateDot/StateDot';
import { PersonaShape, ROLE_SHAPE_MAP } from '../PersonaShape/PersonaShape';
import './RavnAvatar.css';

export interface RavnAvatarProps {
  role: PersonaRole;
  rune: string;
  state: DotState;
  size?: number;
  title?: string;
  className?: string;
}

/**
 * RavnAvatar — deployed-ravn identity glyph.
 *
 * Renders a role-shape outline with the ravn's rune character centered inside,
 * plus a state dot in the bottom-right corner indicating runtime state.
 *
 * Used in Mímir's Ravns tab and Ravn's fleet views.
 *
 * @example
 * <RavnAvatar role="build" rune="ᚺ" state="running" title="Builder ravn" />
 */
export function RavnAvatar({ role, rune, state, size = 28, title, className }: RavnAvatarProps) {
  const shape = ROLE_SHAPE_MAP[role];
  const fontSize = Math.round(size * 0.44);
  const dotSize = Math.round(size * 0.3);
  const isPulsing = state === 'running' || state === 'observing' || state === 'processing';

  return (
    <span
      className={cn('niuu-ravn-avatar', className)}
      style={{ width: size, height: size }}
      title={title ?? `${rune} (${role})`}
      aria-label={title ?? `${rune} — ${role} — ${state}`}
      role="img"
    >
      <PersonaShape shape={shape} size={size} />
      <span className="niuu-ravn-avatar__rune" style={{ fontSize }}>
        {rune}
      </span>
      <span className="niuu-ravn-avatar__dot">
        <StateDot state={state} size={dotSize} pulse={isPulsing} />
      </span>
    </span>
  );
}
