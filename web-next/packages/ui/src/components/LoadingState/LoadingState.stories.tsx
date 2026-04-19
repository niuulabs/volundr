import type { Meta, StoryObj } from '@storybook/react';
import { LoadingState } from './LoadingState';

const meta: Meta<typeof LoadingState> = {
  title: 'Components/LoadingState',
  component: LoadingState,
};
export default meta;

type Story = StoryObj<typeof LoadingState>;

export const Default: Story = {};

export const WithCustomTitle: Story = { args: { title: 'Fetching sessions…' } };

export const WithDescription: Story = {
  args: {
    title: 'Syncing…',
    description: 'Pulling the latest data from the API. This may take a moment.',
  },
};

export const WithCancelAction: Story = {
  args: {
    title: 'Running query…',
    action: (
      <button
        type="button"
        style={{
          padding: 'var(--space-1) var(--space-3)',
          background: 'transparent',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          color: 'var(--color-text-secondary)',
          fontSize: 'var(--text-sm)',
        }}
      >
        Cancel
      </button>
    ),
  },
};
