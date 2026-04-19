import type { Meta, StoryObj } from '@storybook/react';
import { KpiStrip } from './KpiStrip';
import { KpiCard } from '../KpiCard';

const meta: Meta<typeof KpiStrip> = {
  title: 'Components/KpiStrip',
  component: KpiStrip,
};
export default meta;

type Story = StoryObj<typeof KpiStrip>;

export const Default: Story = {
  render: () => (
    <KpiStrip>
      <KpiCard label="Active Sessions" value={142} delta={{ value: '+12', direction: 'up' }} />
      <KpiCard label="Error Rate" value="2.4%" delta={{ value: '+0.8%', direction: 'down' }} />
      <KpiCard label="P99 Latency" value="120ms" delta={{ value: '0ms', direction: 'neutral' }} />
      <KpiCard label="Throughput" value="4.2k/s" delta={{ value: '+8%', direction: 'up' }} />
    </KpiStrip>
  ),
};

export const WithSparklines: Story = {
  render: () => (
    <KpiStrip>
      {[
        { label: 'Requests', value: '12.4k', points: '0,28 20,20 40,22 60,10 80,3' },
        { label: 'Errors', value: 34, points: '0,5 20,8 40,3 60,12 80,6' },
        { label: 'Latency', value: '88ms', points: '0,15 20,18 40,10 60,14 80,8' },
      ].map((item) => (
        <KpiCard
          key={item.label}
          label={item.label}
          value={item.value}
          sparkline={
            <svg width="100%" height="32" viewBox="0 0 80 32" preserveAspectRatio="none">
              <polyline
                points={item.points}
                fill="none"
                stroke="var(--brand-500)"
                strokeWidth="1.5"
              />
            </svg>
          }
        />
      ))}
    </KpiStrip>
  ),
};
