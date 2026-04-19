import {
  PersonaAvatar,
  RavnAvatar,
  MountChip,
  DeployBadge,
  LifecycleBadge,
  type DotState,
  type DeployKind,
  type LifecycleState,
} from '@niuulabs/ui';
import type { PersonaRole } from '@niuulabs/ui';

const PERSONA_ROLES: { role: PersonaRole; letter: string }[] = [
  { role: 'plan', letter: 'P' },
  { role: 'build', letter: 'B' },
  { role: 'verify', letter: 'V' },
  { role: 'review', letter: 'R' },
  { role: 'gate', letter: 'G' },
  { role: 'audit', letter: 'A' },
  { role: 'ship', letter: 'S' },
  { role: 'index', letter: 'I' },
  { role: 'report', letter: 'R' },
];

const RAVN_STATES: DotState[] = ['healthy', 'running', 'idle', 'failed', 'observing'];

const DEPLOY_KINDS: DeployKind[] = ['k8s', 'systemd', 'pi', 'mobile', 'ephemeral'];

const LIFECYCLE_STATES: LifecycleState[] = [
  'requested',
  'provisioning',
  'ready',
  'running',
  'idle',
  'terminating',
  'terminated',
  'failed',
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-muted)',
          marginBottom: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ShowcasePage() {
  return (
    <div
      data-testid="showcase"
      style={{
        padding: 32,
        maxWidth: 800,
        fontFamily: 'var(--font-sans)',
        color: 'var(--color-text-primary)',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xl)',
          marginBottom: 32,
          color: 'var(--brand-300)',
        }}
      >
        NIU-654 · Identity Composites Showcase
      </h1>

      <Section title="PersonaAvatar — all roles">
        <div
          data-testid="persona-avatars"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}
        >
          {PERSONA_ROLES.map(({ role, letter }) => (
            <div
              key={role}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
            >
              <PersonaAvatar role={role} letter={letter} size={32} title={role} />
              <code
                style={{
                  fontSize: 10,
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {role}
              </code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="RavnAvatar — states">
        <div
          data-testid="ravn-avatars"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}
        >
          {RAVN_STATES.map((state) => (
            <div
              key={state}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
            >
              <RavnAvatar role="build" rune="ᚺ" state={state} size={32} title={`ravn-${state}`} />
              <code
                style={{
                  fontSize: 10,
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {state}
              </code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="MountChip — roles">
        <div
          data-testid="mount-chips"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
        >
          <MountChip name="local-ops" role="primary" priority={1} />
          <MountChip name="shared-realm" role="archive" priority={2} />
          <MountChip name="domain-kb" role="ro" priority={3} />
        </div>
      </Section>

      <Section title="DeployBadge — kinds">
        <div
          data-testid="deploy-badges"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
        >
          {DEPLOY_KINDS.map((kind) => (
            <DeployBadge key={kind} kind={kind} />
          ))}
        </div>
      </Section>

      <Section title="LifecycleBadge — states">
        <div
          data-testid="lifecycle-badges"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
        >
          {LIFECYCLE_STATES.map((state) => (
            <LifecycleBadge key={state} state={state} />
          ))}
        </div>
      </Section>
    </div>
  );
}
