import type { Meta, StoryObj } from '@storybook/react';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from './Popover';

const meta: Meta = {
  title: 'Overlays/Popover',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger>
        <button type="button">Open Popover</button>
      </PopoverTrigger>
      <PopoverContent>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
          This is popover content with some helpful information.
        </p>
      </PopoverContent>
    </Popover>
  ),
};

export const WithClose: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger>
        <button type="button">Open with close</button>
      </PopoverTrigger>
      <PopoverContent>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 'var(--space-2)',
          }}
        >
          <p
            style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}
          >
            Popover with a close button.
          </p>
          <PopoverClose />
        </div>
      </PopoverContent>
    </Popover>
  ),
};

export const TopSide: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger>
        <button type="button">Open above</button>
      </PopoverTrigger>
      <PopoverContent side="top">
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
          I appear above the trigger.
        </p>
      </PopoverContent>
    </Popover>
  ),
};

export const ControlledOpen: Story = {
  render: () => (
    <Popover open>
      <PopoverTrigger>
        <button type="button">Trigger</button>
      </PopoverTrigger>
      <PopoverContent>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', margin: 0 }}>
          Always visible in this story.
        </p>
      </PopoverContent>
    </Popover>
  ),
};
