import type { Meta, StoryObj } from '@storybook/react';
import type { PersonaRole } from '@niuulabs/domain';
import type { DotState } from '../../primitives/StateDot/StateDot';
import { RavnAvatar } from './RavnAvatar';

const meta: Meta<typeof RavnAvatar> = {
  title: 'Composites/RavnAvatar',
  component: RavnAvatar,
  args: { role: 'build', rune: 'ᚺ', state: 'idle', size: 32 },
};
export default meta;

type Story = StoryObj<typeof RavnAvatar>;

export const Default: Story = {};

export const Running: Story = { args: { state: 'running' } };
export const Failed: Story = { args: { state: 'failed' } };

export const AllRoles: Story = {
  render: () => {
    const roles: { role: PersonaRole; rune: string }[] = [
      { role: 'plan', rune: 'ᛈ' },
      { role: 'build', rune: 'ᚺ' },
      { role: 'verify', rune: 'ᚹ' },
      { role: 'review', rune: 'ᚱ' },
      { role: 'gate', rune: 'ᚷ' },
      { role: 'audit', rune: 'ᚨ' },
      { role: 'ship', rune: 'ᛋ' },
      { role: 'index', rune: 'ᛗ' },
      { role: 'report', rune: 'ᚱ' },
    ];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        {roles.map(({ role, rune }) => (
          <div
            key={role}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
          >
            <RavnAvatar role={role} rune={rune} state="running" size={36} />
            <code style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{role}</code>
          </div>
        ))}
      </div>
    );
  },
};

export const AllStates: Story = {
  render: () => {
    const states: DotState[] = ['healthy', 'running', 'idle', 'failed', 'observing', 'unknown'];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        {states.map((state) => (
          <div
            key={state}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
          >
            <RavnAvatar role="build" rune="ᚺ" state={state} size={32} />
            <code style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{state}</code>
          </div>
        ))}
      </div>
    );
  },
};
