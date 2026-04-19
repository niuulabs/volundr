import type { Meta, StoryObj } from '@storybook/react';
import { KpiCard } from './KpiCard';

const meta: Meta<typeof KpiCard> = {
  title: 'Components/KpiCard',
  component: KpiCard,
  args: { label: 'Active Sessions', value: 142 },
};
export default meta;

type Story = StoryObj<typeof KpiCard>;

export const Default: Story = {};

export const WithDeltaUp: Story = {
  args: { delta: { value: '+12%', direction: 'up', label: 'vs yesterday' } },
};

export const WithDeltaDown: Story = {
  args: {
    label: 'Error Rate',
    value: '2.4%',
    delta: { value: '+0.8%', direction: 'down' },
  },
};

export const WithDeltaNeutral: Story = {
  args: {
    label: 'P99 Latency',
    value: '120ms',
    delta: { value: '0ms', direction: 'neutral' },
  },
};

export const WithSparkline: Story = {
  args: {
    label: 'Throughput',
    value: '4.2k/s',
    delta: { value: '+8%', direction: 'up' },
    sparkline: (
      <svg width="100%" height="32" viewBox="0 0 80 32" preserveAspectRatio="none">
        <polyline
          points="0,28 10,22 20,25 30,10 40,15 50,8 60,12 70,5 80,3"
          fill="none"
          stroke="var(--brand-500)"
          strokeWidth="1.5"
        />
      </svg>
    ),
  },
};

export const StringValue: Story = {
  args: { label: 'Uptime', value: '99.98%', delta: { value: '+0.01%', direction: 'up' } },
};
