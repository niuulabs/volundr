import type { Meta, StoryObj } from '@storybook/react';
import { Pipe } from './Pipe';

const meta: Meta<typeof Pipe> = {
  title: 'Primitives/Pipe',
  component: Pipe,
  args: {
    phases: [
      { status: 'done' },
      { status: 'done' },
      { status: 'running' },
      { status: 'pending' },
      { status: 'pending' },
    ],
  },
};
export default meta;

type Story = StoryObj<typeof Pipe>;

export const Default: Story = {};

export const AllDone: Story = {
  args: {
    phases: [
      { status: 'done', label: 'fetch' },
      { status: 'done', label: 'parse' },
      { status: 'done', label: 'store' },
      { status: 'done', label: 'emit' },
    ],
  },
};

export const WithFailed: Story = {
  args: {
    phases: [
      { status: 'done', label: 'fetch' },
      { status: 'done', label: 'parse' },
      { status: 'failed', label: 'store' },
      { status: 'skipped', label: 'emit' },
    ],
  },
};

export const AllStatuses: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Pipe phases={[{ status: 'pending' }]} />
      <Pipe phases={[{ status: 'running' }]} />
      <Pipe phases={[{ status: 'done' }]} />
      <Pipe phases={[{ status: 'failed' }]} />
      <Pipe phases={[{ status: 'skipped' }]} />
    </div>
  ),
};

export const LongPipeline: Story = {
  args: {
    phases: Array.from({ length: 12 }, (_, i) => ({
      status: i < 5 ? 'done' : i === 5 ? 'running' : 'pending',
      label: `step-${i + 1}`,
    })),
  },
};
