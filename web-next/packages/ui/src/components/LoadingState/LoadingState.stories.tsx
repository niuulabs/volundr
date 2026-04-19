import type { Meta, StoryObj } from '@storybook/react';
import { LoadingState } from './LoadingState';
import '../__stories__/showcase.css';

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
      <button type="button" className="niuu-story-btn niuu-story-btn--ghost">
        Cancel
      </button>
    ),
  },
};
