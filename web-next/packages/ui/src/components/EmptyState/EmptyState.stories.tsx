import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from './EmptyState';
import '../__stories__/showcase.css';

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
      <button type="button" className="niuu-story-btn niuu-story-btn--brand">
        Create session
      </button>
    ),
  },
};

export const Minimal: Story = {
  args: { title: 'Empty', icon: '∅' },
};
