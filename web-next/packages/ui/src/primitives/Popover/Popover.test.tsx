import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from './Popover';

function TestPopover({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger>Open popover</PopoverTrigger>
      <PopoverContent>
        <p>Popover body</p>
        <PopoverClose />
      </PopoverContent>
    </Popover>
  );
}

describe('Popover', () => {
  it('renders trigger', () => {
    render(<TestPopover />);
    expect(screen.getByText('Open popover')).toBeInTheDocument();
  });

  it('is closed by default', () => {
    render(<TestPopover />);
    expect(screen.queryByText('Popover body')).not.toBeInTheDocument();
  });

  it('opens when open=true', () => {
    render(<TestPopover open />);
    expect(screen.getByText('Popover body')).toBeInTheDocument();
  });

  it('opens when trigger is clicked', async () => {
    render(<TestPopover />);
    await userEvent.click(screen.getByText('Open popover'));
    expect(screen.getByText('Popover body')).toBeInTheDocument();
  });

  it('calls onOpenChange(true) when trigger clicked', async () => {
    const onOpenChange = vi.fn();
    render(<TestPopover onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByText('Open popover'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('calls onOpenChange(false) when close button clicked', async () => {
    const onOpenChange = vi.fn();
    render(<TestPopover open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByText('✕'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('PopoverContent applies custom className', () => {
    render(
      <Popover open>
        <PopoverContent className="my-popover">content</PopoverContent>
      </Popover>,
    );
    const content = screen.getByText('content').closest('[class*="niuu-popover"]');
    expect(content).toHaveClass('my-popover');
  });

  it('PopoverClose renders custom children', () => {
    render(
      <Popover open>
        <PopoverContent>
          <PopoverClose>Dismiss</PopoverClose>
        </PopoverContent>
      </Popover>,
    );
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('PopoverClose applies custom className', () => {
    render(
      <Popover open>
        <PopoverContent>
          <PopoverClose className="x-btn">X</PopoverClose>
        </PopoverContent>
      </Popover>,
    );
    expect(screen.getByText('X')).toHaveClass('x-btn');
  });

  it('PopoverTrigger works with asChild', async () => {
    const onOpenChange = vi.fn();
    render(
      <Popover onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button type="button">Custom btn</button>
        </PopoverTrigger>
        <PopoverContent>body</PopoverContent>
      </Popover>,
    );
    await userEvent.click(screen.getByText('Custom btn'));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('PopoverContent supports side and align props', () => {
    render(
      <Popover open>
        <PopoverContent side="left" align="start">
          side content
        </PopoverContent>
      </Popover>,
    );
    expect(screen.getByText('side content')).toBeInTheDocument();
  });
});
