import type { PersonaRole } from '@niuulabs/domain';
import { cn } from '../../utils/cn';
import { PersonaShape, ROLE_SHAPE_MAP } from '../PersonaShape/PersonaShape';
import './PersonaAvatar.css';

export interface PersonaAvatarProps {
  role: PersonaRole;
  letter: string;
  size?: number;
  title?: string;
  className?: string;
}

/**
 * PersonaAvatar — role-shape outline with a single letter glyph inside.
 *
 * The role → shape mapping is deterministic: the same role always renders the
 * same shape. Use this anywhere a persona needs identity representation.
 *
 * @example
 * <PersonaAvatar role="build" letter="B" size={28} title="Builder persona" />
 */
export function PersonaAvatar({ role, letter, size = 24, title, className }: PersonaAvatarProps) {
  const shape = ROLE_SHAPE_MAP[role];
  const firstLetter = letter.charAt(0).toUpperCase();
  const fontSize = Math.round(size * 0.42);

  return (
    <span
      className={cn('niuu-persona-avatar', className)}
      style={{ width: size, height: size }}
      title={title ?? role}
      aria-label={title ?? role}
      role="img"
    >
      <PersonaShape shape={shape} size={size} />
      <span className="niuu-persona-avatar__letter" style={{ fontSize }}>
        {firstLetter}
      </span>
    </span>
  );
}
