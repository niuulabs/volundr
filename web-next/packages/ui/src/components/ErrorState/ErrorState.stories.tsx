import type { Meta, StoryObj } from '@storybook/react';
import { ErrorState } from './ErrorState';
import '../__stories__/showcase.css';

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
      <button type="button" className="niuu-story-btn niuu-story-btn--danger">
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
