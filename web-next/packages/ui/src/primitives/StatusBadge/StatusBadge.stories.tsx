import type { Meta, StoryObj } from '@storybook/react';
import { StatusBadge } from './StatusBadge';
import type { StatusBadgeStatus } from './StatusBadge';

const meta: Meta<typeof StatusBadge> = {
  title: 'Primitives/StatusBadge',
  component: StatusBadge,
  args: { status: 'ok' },
};
export default meta;

type Story = StoryObj<typeof StatusBadge>;

export const Ok: Story = { args: { status: 'ok' } };
export const Running: Story = { args: { status: 'running' } };
export const Queued: Story = { args: { status: 'queued' } };
export const Review: Story = { args: { status: 'review' } };
export const Failed: Story = { args: { status: 'failed' } };
export const Archived: Story = { args: { status: 'archived' } };

const allStatuses: StatusBadgeStatus[] = ['running', 'queued', 'ok', 'review', 'failed', 'archived'];

export const AllStatuses: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {allStatuses.map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
};
