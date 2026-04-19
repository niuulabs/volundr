import type { Meta, StoryObj } from '@storybook/react';
import type { LifecycleState } from './LifecycleBadge';
import { LifecycleBadge } from './LifecycleBadge';

const meta: Meta<typeof LifecycleBadge> = {
  title: 'Composites/LifecycleBadge',
  component: LifecycleBadge,
  args: { state: 'running' },
};
export default meta;

type Story = StoryObj<typeof LifecycleBadge>;

export const Running: Story = {};
export const Provisioning: Story = { args: { state: 'provisioning' } };
export const Ready: Story = { args: { state: 'ready' } };
export const Idle: Story = { args: { state: 'idle' } };
export const Terminating: Story = { args: { state: 'terminating' } };
export const Terminated: Story = { args: { state: 'terminated' } };
export const Failed: Story = { args: { state: 'failed' } };

export const AllStates: Story = {
  render: () => {
    const states: LifecycleState[] = [
      'requested',
      'provisioning',
      'ready',
      'running',
      'idle',
      'terminating',
      'terminated',
      'failed',
    ];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {states.map((state) => (
          <LifecycleBadge key={state} state={state} />
        ))}
      </div>
    );
  },
};
