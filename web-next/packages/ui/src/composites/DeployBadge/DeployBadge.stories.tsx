import type { Meta, StoryObj } from '@storybook/react';
import type { DeployKind } from './DeployBadge';
import { DeployBadge } from './DeployBadge';

const meta: Meta<typeof DeployBadge> = {
  title: 'Composites/DeployBadge',
  component: DeployBadge,
  args: { kind: 'k8s' },
};
export default meta;

type Story = StoryObj<typeof DeployBadge>;

export const K8s: Story = {};
export const Systemd: Story = { args: { kind: 'systemd' } };
export const Pi: Story = { args: { kind: 'pi' } };
export const Mobile: Story = { args: { kind: 'mobile' } };
export const Ephemeral: Story = { args: { kind: 'ephemeral' } };

export const AllKinds: Story = {
  render: () => {
    const kinds: DeployKind[] = ['k8s', 'systemd', 'pi', 'mobile', 'ephemeral'];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {kinds.map((kind) => (
          <DeployBadge key={kind} kind={kind} />
        ))}
      </div>
    );
  },
};
