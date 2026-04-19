import type { Meta, StoryObj } from '@storybook/react';
import { ErrorState } from './ErrorState';

const meta: Meta<typeof ErrorState> = {
  title: 'Components/ErrorState',
  component: ErrorState,
  args: { title: 'Something went wrong' },
};
export default meta;

type Story = StoryObj<typeof ErrorState>;

export const Default: Story = {};

export const WithDescription: Story = {
  args: {
    description: 'Error: connect ECONNREFUSED 127.0.0.1:8080',
  },
};

export const WithRetryAction: Story = {
  args: {
    title: 'Failed to load sessions',
    description: 'The session service is unavailable. Check connectivity and try again.',
    action: (
      <button
        type="button"
        style={{
          padding: 'var(--space-2) var(--space-4)',
          background: 'var(--color-critical-bg)',
          border: '1px solid var(--color-critical-bo)',
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          color: 'var(--color-critical-fg)',
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
        }}
      >
        ↻ Retry
      </button>
    ),
  },
};

export const CustomIcon: Story = {
  args: {
    icon: '🔒',
    title: 'Permission denied',
    description: 'You do not have access to view this resource.',
  },
};
