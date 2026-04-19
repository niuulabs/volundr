import type { Meta, StoryObj } from '@storybook/react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './Tooltip';

const meta: Meta = {
  title: 'Overlays/Tooltip',
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger>
        <button type="button">Hover me</button>
      </TooltipTrigger>
      <TooltipContent>This is a tooltip</TooltipContent>
    </Tooltip>
  ),
};

export const TopSide: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger>
        <button type="button">Top tooltip</button>
      </TooltipTrigger>
      <TooltipContent side="top">Appears above</TooltipContent>
    </Tooltip>
  ),
};

export const BottomSide: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger>
        <button type="button">Bottom tooltip</button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Appears below</TooltipContent>
    </Tooltip>
  ),
};

export const LeftSide: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger>
        <button type="button">Left tooltip</button>
      </TooltipTrigger>
      <TooltipContent side="left">Appears left</TooltipContent>
    </Tooltip>
  ),
};

export const RightSide: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger>
        <button type="button">Right tooltip</button>
      </TooltipTrigger>
      <TooltipContent side="right">Appears right</TooltipContent>
    </Tooltip>
  ),
};

export const ControlledOpen: Story = {
  render: () => (
    <Tooltip open>
      <TooltipTrigger>
        <button type="button">Always visible</button>
      </TooltipTrigger>
      <TooltipContent>Always visible tooltip</TooltipContent>
    </Tooltip>
  ),
};
