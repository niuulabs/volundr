import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import {
  ToastProvider,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
} from './Toast';

const meta: Meta = {
  title: 'Overlays/Toast',
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <ToastProvider duration={Infinity}>
        <Story />
      </ToastProvider>
    ),
  ],
};
export default meta;

type Story = StoryObj;

function DefaultDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Show Toast
      </button>
      <Toast open={open} onOpenChange={setOpen}>
        <ToastTitle>Event saved</ToastTitle>
        <ToastDescription>Your changes have been saved successfully.</ToastDescription>
        <ToastClose />
      </Toast>
    </>
  );
}

export const Default: Story = { render: () => <DefaultDemo /> };

export const Success: Story = {
  render: () => (
    <Toast open variant="success">
      <ToastTitle>Success</ToastTitle>
      <ToastDescription>Operation completed successfully.</ToastDescription>
      <ToastClose />
    </Toast>
  ),
};

export const Error: Story = {
  render: () => (
    <Toast open variant="error">
      <ToastTitle>Error</ToastTitle>
      <ToastDescription>Something went wrong. Please try again.</ToastDescription>
      <ToastClose />
    </Toast>
  ),
};

export const Warning: Story = {
  render: () => (
    <Toast open variant="warning">
      <ToastTitle>Warning</ToastTitle>
      <ToastDescription>This action may have unintended side effects.</ToastDescription>
      <ToastClose />
    </Toast>
  ),
};

export const WithAction: Story = {
  render: () => (
    <Toast open>
      <div>
        <ToastTitle>File deleted</ToastTitle>
        <ToastDescription>config.yaml was moved to trash.</ToastDescription>
      </div>
      <ToastAction altText="Undo file deletion">Undo</ToastAction>
      <ToastClose />
    </Toast>
  ),
};

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: 360 }}>
      <Toast open>
        <ToastTitle>Default</ToastTitle>
        <ToastDescription>Default notification.</ToastDescription>
      </Toast>
      <Toast open variant="success">
        <ToastTitle>Success</ToastTitle>
        <ToastDescription>Operation succeeded.</ToastDescription>
      </Toast>
      <Toast open variant="error">
        <ToastTitle>Error</ToastTitle>
        <ToastDescription>Something went wrong.</ToastDescription>
      </Toast>
      <Toast open variant="warning">
        <ToastTitle>Warning</ToastTitle>
        <ToastDescription>Proceed with caution.</ToastDescription>
      </Toast>
    </div>
  ),
};
