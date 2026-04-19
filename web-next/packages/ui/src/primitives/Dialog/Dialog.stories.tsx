import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogClose,
} from './Dialog';

const meta: Meta = {
  title: 'Overlays/Dialog',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

function DefaultDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <button type="button">Open Dialog</button>
      </DialogTrigger>
      <DialogContent title="Confirm action" description="This action cannot be undone.">
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          Are you sure you want to delete this item? All associated data will be permanently
          removed.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button">Cancel</button>
          </DialogClose>
          <button type="button" onClick={() => setOpen(false)}>
            Delete
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WithHeaderDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <button type="button">Open With Header</button>
      </DialogTrigger>
      <DialogContent title="Settings" description="Manage your account settings.">
        <DialogHeader>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Account › General
          </span>
          <DialogClose />
        </DialogHeader>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          Dialog content goes here.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function LongContentDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <button type="button">Long Content</button>
      </DialogTrigger>
      <DialogContent title="Terms of Service">
        {Array.from({ length: 20 }, (_, i) => (
          <p
            key={i}
            style={{
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-3)',
            }}
          >
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Section {i + 1}.
          </p>
        ))}
        <DialogFooter>
          <DialogClose asChild>
            <button type="button">Decline</button>
          </DialogClose>
          <button type="button" onClick={() => setOpen(false)}>
            Accept
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const Default: Story = { render: () => <DefaultDemo /> };

export const WithHeader: Story = { render: () => <WithHeaderDemo /> };

export const ControlledOpen: Story = {
  render: () => (
    <Dialog open>
      <DialogContent title="Always open" description="This dialog is always open in this story.">
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          You can see the dialog without interaction.
        </p>
        <DialogFooter>
          <button type="button">OK</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const LongContent: Story = { render: () => <LongContentDemo /> };
