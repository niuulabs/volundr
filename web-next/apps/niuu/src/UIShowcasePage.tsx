import {
  PersonaAvatar,
  RavnAvatar,
  MountChip,
  DeployBadge,
  LifecycleBadge,
} from '@niuulabs/ui';
import type { PersonaRole } from '@niuulabs/domain';
import type { LifecycleState, DeploymentKind, MountChipRole } from '@niuulabs/ui';

const ROLES: PersonaRole[] = [
  'plan', 'build', 'verify', 'review', 'gate', 'audit', 'ship', 'index', 'report',
];

const LIFECYCLE_STATES: LifecycleState[] = [
  'provisioning', 'ready', 'running', 'idle', 'terminating', 'terminated', 'failed',
];

const DEPLOY_KINDS: DeploymentKind[] = ['k8s', 'systemd', 'pi', 'mobile', 'ephemeral'];

const MOUNT_ROLES: MountChipRole[] = ['primary', 'archive', 'ro', 'local', 'shared', 'domain'];

const sectionStyle = {
  marginBottom: '32px',
};

const headingStyle = {
  fontSize: '10px',
  fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.07em',
  color: 'var(--color-text-muted)',
  marginBottom: '12px',
};

const rowStyle = {
  display: 'flex',
  gap: '12px',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
};

export function UIShowcasePage() {
  return (
    <div
      data-testid="ui-showcase"
      style={{
        padding: '32px',
        background: 'var(--color-bg-primary)',
        minHeight: '100vh',
        color: 'var(--color-text-primary)',
      }}
    >
      <h1
        style={{
          fontSize: '16px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--brand-300)',
          marginBottom: '32px',
        }}
      >
        UI Composites Showcase
      </h1>

      <section style={sectionStyle} data-testid="section-persona-avatar">
        <div style={headingStyle}>PersonaAvatar — all roles</div>
        <div style={rowStyle}>
          {ROLES.map((role) => (
            <PersonaAvatar
              key={role}
              role={role}
              letter={role[0].toUpperCase()}
              size={32}
            />
          ))}
        </div>
      </section>

      <section style={sectionStyle} data-testid="section-ravn-avatar">
        <div style={headingStyle}>RavnAvatar — all roles</div>
        <div style={rowStyle}>
          {ROLES.map((role) => (
            <RavnAvatar key={role} role={role} rune="ᚱ" state="idle" size={32} />
          ))}
        </div>
      </section>

      <section style={sectionStyle} data-testid="section-mount-chip">
        <div style={headingStyle}>MountChip — all roles</div>
        <div style={rowStyle}>
          {MOUNT_ROLES.map((role) => (
            <MountChip key={role} name="knowledge-well" role={role} priority={1} />
          ))}
        </div>
      </section>

      <section style={sectionStyle} data-testid="section-deploy-badge">
        <div style={headingStyle}>DeployBadge — all kinds</div>
        <div style={rowStyle}>
          {DEPLOY_KINDS.map((d) => (
            <DeployBadge key={d} deployment={d} />
          ))}
        </div>
      </section>

      <section style={sectionStyle} data-testid="section-lifecycle-badge">
        <div style={headingStyle}>LifecycleBadge — all states</div>
        <div style={rowStyle}>
          {LIFECYCLE_STATES.map((state) => (
            <LifecycleBadge key={state} state={state} />
          ))}
        </div>
      </section>
    </div>
  );
}
