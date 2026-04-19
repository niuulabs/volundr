import type { Meta, StoryObj } from '@storybook/react';
import { ConfidenceBar } from './ConfidenceBar';

const meta: Meta<typeof ConfidenceBar> = {
  title: 'Primitives/ConfidenceBar',
  component: ConfidenceBar,
  args: { level: 'high', value: 0.8, showLabel: false },
};
export default meta;

type Story = StoryObj<typeof ConfidenceBar>;

export const High: Story = { args: { level: 'high', value: 0.85 } };
export const Medium: Story = { args: { level: 'medium', value: 0.55 } };
export const Low: Story = { args: { level: 'low', value: 0.2 } };
export const WithLabel: Story = { args: { level: 'high', value: 0.85, showLabel: true } };

export const AllLevels: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <ConfidenceBar level="high" value={0.85} showLabel />
      <ConfidenceBar level="medium" value={0.55} showLabel />
      <ConfidenceBar level="low" value={0.2} showLabel />
    </div>
  ),
};

export const ValueRange: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 8 }}>
      {[0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((v) => (
        <ConfidenceBar
          key={v}
          level={v >= 0.7 ? 'high' : v >= 0.4 ? 'medium' : 'low'}
          value={v}
          showLabel
        />
      ))}
    </div>
  ),
};
