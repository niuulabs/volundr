import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerClose,
  DrawerHeader,
  DrawerFooter,
} from './Drawer';

function TestDrawer({
  open,
  onOpenChange,
  side,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  side?: 'right' | 'left';
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger>Open drawer</DrawerTrigger>
      <DrawerContent title="Drawer title" description="Drawer desc" side={side}>
        <p>Drawer body</p>
        <DrawerClose />
      </DrawerContent>
    </Drawer>
  );
}

describe('Drawer', () => {
  it('renders trigger', () => {
    render(<TestDrawer />);
    expect(screen.getByText('Open drawer')).toBeInTheDocument();
  });

  it('is closed by default', () => {
    render(<TestDrawer />);
    expect(screen.queryByText('Drawer body')).not.toBeInTheDocument();
  });

  it('opens when open=true', () => {
    render(<TestDrawer open />);
    expect(screen.getByText('Drawer body')).toBeInTheDocument();
  });

  it('shows title and description when open', () => {
    render(<TestDrawer open />);
    expect(screen.getByText('Drawer title')).toBeInTheDocument();
    expect(screen.getByText('Drawer desc')).toBeInTheDocument();
  });

  it('renders without description', () => {
    render(
      <Drawer open>
        <DrawerContent title="No desc">body</DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText('No desc')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('applies right side class by default', () => {
    render(<TestDrawer open />);
    expect(screen.getByRole('dialog')).toHaveClass('niuu-drawer__content--right');
  });

  it('applies left side class when side=left', () => {
    render(<TestDrawer open side="left" />);
    expect(screen.getByRole('dialog')).toHaveClass('niuu-drawer__content--left');
  });

  it('calls onOpenChange when trigger clicked', async () => {
    const onOpenChange = vi.fn();
    render(<TestDrawer onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByText('Open drawer'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('calls onOpenChange(false) when close button clicked', async () => {
    const onOpenChange = vi.fn();
    render(<TestDrawer open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByText('✕'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange(false) when Escape is pressed', async () => {
    const onOpenChange = vi.fn();
    render(<TestDrawer open onOpenChange={onOpenChange} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('applies custom width', () => {
    render(
      <Drawer open>
        <DrawerContent title="T" width={480}>
          body
        </DrawerContent>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveStyle({ width: '480px' });
  });

  it('renders DrawerHeader', () => {
    render(
      <Drawer open>
        <DrawerContent title="T">
          <DrawerHeader>Header</DrawerHeader>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText('Header')).toBeInTheDocument();
  });

  it('renders DrawerFooter', () => {
    render(
      <Drawer open>
        <DrawerContent title="T">
          <DrawerFooter>Footer</DrawerFooter>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('DrawerClose renders custom children', () => {
    render(
      <Drawer open>
        <DrawerContent title="T">
          <DrawerClose>Close</DrawerClose>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('DrawerClose applies className', () => {
    render(
      <Drawer open>
        <DrawerContent title="T">
          <DrawerClose className="x-close">X</DrawerClose>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText('X')).toHaveClass('x-close');
  });

  it('DrawerHeader applies className', () => {
    render(
      <Drawer open>
        <DrawerContent title="T">
          <DrawerHeader className="x-header">H</DrawerHeader>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText('H')).toHaveClass('x-header');
  });

  it('DrawerFooter applies className', () => {
    render(
      <Drawer open>
        <DrawerContent title="T">
          <DrawerFooter className="x-footer">F</DrawerFooter>
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByText('F')).toHaveClass('x-footer');
  });

  it('DrawerContent applies custom className', () => {
    render(
      <Drawer open>
        <DrawerContent title="T" className="my-drawer">
          body
        </DrawerContent>
      </Drawer>,
    );
    expect(screen.getByRole('dialog')).toHaveClass('my-drawer');
  });

  it('DrawerTrigger works with asChild', async () => {
    const onOpenChange = vi.fn();
    render(
      <Drawer onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>
          <button type="button">Custom</button>
        </DrawerTrigger>
        <DrawerContent title="T">body</DrawerContent>
      </Drawer>,
    );
    await userEvent.click(screen.getByText('Custom'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
