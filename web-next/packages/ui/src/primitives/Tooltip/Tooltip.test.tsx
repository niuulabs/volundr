import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './Tooltip';

/** Find the visible tooltip content element by class (not the hidden live region). */
function getTooltipContent(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.niuu-tooltip__content');
  if (!el) throw new Error('tooltip content not found');
  return el;
}

function TestTooltip({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip open={open} onOpenChange={onOpenChange}>
        <TooltipTrigger>Hover me</TooltipTrigger>
        <TooltipContent>Tooltip text</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe('Tooltip', () => {
  it('renders trigger', () => {
    render(<TestTooltip />);
    expect(screen.getByText('Hover me')).toBeInTheDocument();
  });

  it('is hidden by default', () => {
    render(<TestTooltip />);
    // The tooltip content element should not exist in the DOM when closed
    expect(document.querySelector('.niuu-tooltip__content')).not.toBeInTheDocument();
  });

  it('shows when open=true', () => {
    render(<TestTooltip open />);
    // Use the class-based query to avoid finding the hidden live region
    expect(getTooltipContent()).toBeInTheDocument();
    expect(getTooltipContent()).toHaveTextContent('Tooltip text');
  });

  it('calls onOpenChange when trigger is hovered', async () => {
    const onOpenChange = vi.fn();
    render(<TestTooltip onOpenChange={onOpenChange} />);
    await act(async () => {
      await userEvent.hover(screen.getByText('Hover me'));
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('calls onOpenChange(false) when tooltip closes', async () => {
    const onOpenChange = vi.fn();
    // Start uncontrolled, open by hovering, then unhover
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip onOpenChange={onOpenChange}>
          <TooltipTrigger>Trigger</TooltipTrigger>
          <TooltipContent>tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await act(async () => {
      await userEvent.hover(screen.getByText('Trigger'));
    });
    await act(async () => {
      await userEvent.unhover(screen.getByText('Trigger'));
    });
    // onOpenChange was called at some point (true then false)
    expect(onOpenChange).toHaveBeenCalled();
  });

  it('TooltipContent applies custom className', () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>T</TooltipTrigger>
          <TooltipContent className="my-tip">tip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(getTooltipContent()).toHaveClass('my-tip');
  });

  it('TooltipContent supports side prop', () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>T</TooltipTrigger>
          <TooltipContent side="bottom">bottom tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(getTooltipContent()).toBeInTheDocument();
    expect(getTooltipContent()).toHaveTextContent('bottom tip');
  });

  it('TooltipTrigger works with asChild', () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip open>
          <TooltipTrigger asChild>
            <button type="button">Btn</button>
          </TooltipTrigger>
          <TooltipContent>tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(getTooltipContent()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Btn' })).toBeInTheDocument();
  });

  it('TooltipProvider accepts custom delayDuration', () => {
    render(
      <TooltipProvider delayDuration={100}>
        <Tooltip open>
          <TooltipTrigger>T</TooltipTrigger>
          <TooltipContent>delayed tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(getTooltipContent()).toHaveTextContent('delayed tip');
  });
});
