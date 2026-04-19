import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogClose,
  DialogHeader,
  DialogFooter,
} from './Dialog';

function TestDialog({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger>Open dialog</DialogTrigger>
      <DialogContent title="Test title" description="Test description">
        <p>Dialog body</p>
        <DialogClose />
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog', () => {
  it('renders trigger', () => {
    render(<TestDialog />);
    expect(screen.getByText('Open dialog')).toBeInTheDocument();
  });

  it('is closed by default', () => {
    render(<TestDialog />);
    expect(screen.queryByText('Dialog body')).not.toBeInTheDocument();
  });

  it('opens when open=true', () => {
    render(<TestDialog open />);
    expect(screen.getByText('Dialog body')).toBeInTheDocument();
  });

  it('shows title and description when open', () => {
    render(<TestDialog open />);
    expect(screen.getByText('Test title')).toBeInTheDocument();
    expect(screen.getByText('Test description')).toBeInTheDocument();
  });

  it('renders content without description', () => {
    render(
      <Dialog open>
        <DialogContent title="No desc">body</DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('No desc')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('calls onOpenChange when trigger clicked', async () => {
    const onOpenChange = vi.fn();
    render(<TestDialog onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByText('Open dialog'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('calls onOpenChange(false) when close button clicked', async () => {
    const onOpenChange = vi.fn();
    render(<TestDialog open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByText('✕'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange(false) when Escape is pressed', async () => {
    const onOpenChange = vi.fn();
    render(<TestDialog open onOpenChange={onOpenChange} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders DialogHeader', () => {
    render(
      <Dialog open>
        <DialogContent title="T">
          <DialogHeader>Header content</DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('Header content')).toBeInTheDocument();
  });

  it('renders DialogFooter', () => {
    render(
      <Dialog open>
        <DialogContent title="T">
          <DialogFooter>Footer content</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('Footer content')).toBeInTheDocument();
  });

  it('DialogClose renders custom children', () => {
    render(
      <Dialog open>
        <DialogContent title="T">
          <DialogClose>Close me</DialogClose>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('Close me')).toBeInTheDocument();
  });

  it('DialogClose applies custom className', () => {
    render(
      <Dialog open>
        <DialogContent title="T">
          <DialogClose className="my-close">✕</DialogClose>
        </DialogContent>
      </Dialog>,
    );
    const btn = screen.getByText('✕');
    expect(btn).toHaveClass('my-close');
  });

  it('DialogHeader applies custom className', () => {
    render(
      <Dialog open>
        <DialogContent title="T">
          <DialogHeader className="my-header">h</DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('h')).toHaveClass('my-header');
  });

  it('DialogFooter applies custom className', () => {
    render(
      <Dialog open>
        <DialogContent title="T">
          <DialogFooter className="my-footer">f</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('f')).toHaveClass('my-footer');
  });

  it('DialogContent applies custom className', () => {
    render(
      <Dialog open>
        <DialogContent title="T" className="my-content">
          content
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toHaveClass('my-content');
  });

  it('DialogTrigger works with asChild', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <button type="button">Custom trigger</button>
        </DialogTrigger>
        <DialogContent title="T">body</DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByText('Custom trigger'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
