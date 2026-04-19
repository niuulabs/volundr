import { cn } from '../../utils/cn';
import './MountChip.css';

/**
 * Access role of a raven to a Mímir mount.
 *
 * - `primary` — raven's primary write target.
 * - `archive` — secondary write target (historical / backup).
 * - `ro` — read-only access.
 */
export type MountAccessRole = 'primary' | 'archive' | 'ro';

export interface MountChipProps {
  name: string;
  role: MountAccessRole;
  priority?: number;
  className?: string;
}

const ROLE_LABEL: Record<MountAccessRole, string> = {
  primary: 'prim',
  archive: 'arch',
  ro: 'ro',
};

/**
 * MountChip — compact pill showing a mount name and its raven access role.
 *
 * Roles:
 * - `primary` → brand color (primary write mount)
 * - `archive` → amber (archive / secondary write)
 * - `ro` → muted (read-only)
 *
 * When `priority` is provided it appears in the tooltip as `· p1`.
 *
 * @example
 * <MountChip name="local-ops" role="primary" priority={1} />
 */
export function MountChip({ name, role, priority, className }: MountChipProps) {
  const tooltip = `${name} (${role}${priority != null ? ` · p${priority}` : ''})`;

  return (
    <span className={cn('niuu-mount-chip', `niuu-mount-chip--${role}`, className)} title={tooltip}>
      <span className="niuu-mount-chip__dot" aria-hidden />
      <span className="niuu-mount-chip__name">{name}</span>
      <span className="niuu-mount-chip__role">{ROLE_LABEL[role]}</span>
    </span>
  );
}
