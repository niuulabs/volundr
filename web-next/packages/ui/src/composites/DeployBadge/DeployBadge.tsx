import { cn } from '../../utils/cn';
import './DeployBadge.css';

export type DeployKind = 'k8s' | 'systemd' | 'pi' | 'mobile' | 'ephemeral';

const DEPLOY_GLYPH: Record<DeployKind, string> = {
  k8s: '◇',
  systemd: '◈',
  pi: '◆',
  mobile: '▲',
  ephemeral: '◌',
};

const DEPLOY_LABEL: Record<DeployKind, string> = {
  k8s: 'k8s',
  systemd: 'systemd',
  pi: 'pi',
  mobile: 'mobile',
  ephemeral: 'ephemeral',
};

export interface DeployBadgeProps {
  kind: DeployKind;
  className?: string;
}

/**
 * DeployBadge — deployment-kind identifier glyph + label.
 *
 * Glyphs: k8s ◇ / systemd ◈ / pi ◆ / mobile ▲ / ephemeral ◌
 *
 * @example
 * <DeployBadge kind="k8s" />
 */
export function DeployBadge({ kind, className }: DeployBadgeProps) {
  return (
    <span
      className={cn('niuu-deploy-badge', `niuu-deploy-badge--${kind}`, className)}
      title={kind}
      aria-label={`deployed via ${kind}`}
    >
      <span className="niuu-deploy-badge__glyph" aria-hidden>
        {DEPLOY_GLYPH[kind]}
      </span>
      <span className="niuu-deploy-badge__label">{DEPLOY_LABEL[kind]}</span>
    </span>
  );
}
