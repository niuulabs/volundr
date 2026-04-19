import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerClose,
} from './Drawer';

const meta: Meta = {
  title: 'Overlays/Drawer',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

function RightDrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger>
        <button type="button">Open Right Drawer</button>
      </DrawerTrigger>
      <DrawerContent title="Details" description="View and edit item details." side="right">
        <DrawerHeader>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Item #42
          </span>
          <DrawerClose />
        </DrawerHeader>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          Drawer content goes here.
        </p>
        <DrawerFooter>
          <button type="button" onClick={() => setOpen(false)}>
            Close
          </button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function LeftDrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger>
        <button type="button">Open Left Drawer</button>
      </DrawerTrigger>
      <DrawerContent title="Navigation" side="left" width={280}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          Navigation panel content.
        </p>
      </DrawerContent>
    </Drawer>
  );
}

function WideDrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger>
        <button type="button">Open Wide Drawer</button>
      </DrawerTrigger>
      <DrawerContent title="Wide Panel" side="right" width={560}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          This drawer is 560px wide for complex content.
        </p>
      </DrawerContent>
    </Drawer>
  );
}

export const RightDrawer: Story = { render: () => <RightDrawerDemo /> };

export const LeftDrawer: Story = { render: () => <LeftDrawerDemo /> };

export const ControlledOpen: Story = {
  render: () => (
    <Drawer open>
      <DrawerContent title="Always open" description="This drawer is always open." side="right">
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          Persistent drawer content.
        </p>
      </DrawerContent>
    </Drawer>
  ),
};

export const WideDrawer: Story = { render: () => <WideDrawerDemo /> };
