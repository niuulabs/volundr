import type { Meta, StoryObj } from '@storybook/react';
import { ConfidenceBadge } from './ConfidenceBadge';

const meta: Meta<typeof ConfidenceBadge> = {
  title: 'Primitives/ConfidenceBadge',
  component: ConfidenceBadge,
  args: { value: 0.75 },
};
export default meta;

type Story = StoryObj<typeof ConfidenceBadge>;

export const High: Story = { args: { value: 0.85 } };
export const Medium: Story = { args: { value: 0.55 } };
export const Low: Story = { args: { value: 0.2 } };
export const Empty: Story = { args: { value: null } };
export const Zero: Story = { args: { value: 0 } };

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
      <ConfidenceBadge value={0.92} />
      <ConfidenceBadge value={0.55} />
      <ConfidenceBadge value={0.18} />
      <ConfidenceBadge value={null} />
      <ConfidenceBadge value={0} />
    </div>
  ),
};
