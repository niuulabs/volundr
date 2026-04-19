import type { Meta, StoryObj } from '@storybook/react';
import type { PersonaRole } from '@niuulabs/domain';
import { PersonaAvatar } from './PersonaAvatar';

const meta: Meta<typeof PersonaAvatar> = {
  title: 'Composites/PersonaAvatar',
  component: PersonaAvatar,
  args: { role: 'build', letter: 'B', size: 28 },
};
export default meta;

type Story = StoryObj<typeof PersonaAvatar>;

export const Default: Story = {};

export const AllRoles: Story = {
  render: () => {
    const roles: { role: PersonaRole; letter: string }[] = [
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
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        {roles.map(({ role, letter }) => (
          <div
            key={role}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
          >
            <PersonaAvatar role={role} letter={letter} size={32} />
            <code style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{role}</code>
          </div>
        ))}
      </div>
    );
  },
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      {[16, 24, 32, 40, 48].map((size) => (
        <PersonaAvatar key={size} role="build" letter="B" size={size} />
      ))}
    </div>
  ),
};
