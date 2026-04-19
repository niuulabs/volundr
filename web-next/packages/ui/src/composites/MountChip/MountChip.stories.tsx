import type { Meta, StoryObj } from '@storybook/react';
import { MountChip } from './MountChip';

const meta: Meta<typeof MountChip> = {
  title: 'Composites/MountChip',
  component: MountChip,
  args: { name: 'local-ops', role: 'primary', priority: 1 },
};
export default meta;

type Story = StoryObj<typeof MountChip>;

export const Primary: Story = {};
export const Archive: Story = { args: { name: 'shared-realm', role: 'archive', priority: 2 } };
export const ReadOnly: Story = { args: { name: 'domain-kb', role: 'ro', priority: 3 } };

export const AllRoles: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <MountChip name="local-ops" role="primary" priority={1} />
      <MountChip name="shared-realm" role="archive" priority={2} />
      <MountChip name="domain-kb" role="ro" priority={3} />
    </div>
  ),
};

export const PriorityOrdered: Story = {
  render: () => {
    const mounts = [
      { name: 'shared-realm', role: 'archive' as const, priority: 3 },
      { name: 'local-ops', role: 'primary' as const, priority: 1 },
      { name: 'domain-kb', role: 'ro' as const, priority: 2 },
    ].sort((a, b) => a.priority - b.priority);

    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {mounts.map((m) => (
          <MountChip key={m.name} name={m.name} role={m.role} priority={m.priority} />
        ))}
      </div>
    );
  },
};
