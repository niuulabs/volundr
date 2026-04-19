import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
  args: { title: 'No results found' },
};
export default meta;

type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {};

export const WithDescription: Story = {
  args: { description: 'Try adjusting your search or filter criteria.' },
};

export const WithIconAndAction: Story = {
  args: {
    icon: '📭',
    title: 'No sessions yet',
    description: 'Sessions will appear here once a raven completes its first run.',
    action: (
      <button
        type="button"
        style={{
          padding: 'var(--space-2) var(--space-4)',
          background: 'var(--color-brand)',
          color: '#000',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
        }}
      >
        Create session
      </button>
    ),
  },
};

export const Minimal: Story = {
  args: { title: 'Empty', icon: '∅' },
};
