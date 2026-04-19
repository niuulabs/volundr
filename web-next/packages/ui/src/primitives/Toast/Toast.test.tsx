import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ToastProvider,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
  ToastViewport,
} from './Toast';

function TestToast({
  open = true,
  onOpenChange,
  variant,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  variant?: 'default' | 'success' | 'error' | 'warning';
}) {
  return (
    <ToastProvider duration={Infinity}>
      <Toast open={open} onOpenChange={onOpenChange} variant={variant}>
        <ToastTitle>Toast title</ToastTitle>
        <ToastDescription>Toast description</ToastDescription>
        <ToastClose />
      </Toast>
    </ToastProvider>
  );
}

/** Finds the niuu toast root element (not Radix's hidden live-region). */
function getToastRoot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.niuu-toast');
  if (!el) throw new Error('toast root not found');
  return el;
}

describe('Toast', () => {
  it('renders title when open', () => {
    render(<TestToast open />);
    expect(screen.getByText('Toast title')).toBeInTheDocument();
  });

  it('renders description when open', () => {
    render(<TestToast open />);
    expect(screen.getByText('Toast description')).toBeInTheDocument();
  });

  it('is hidden when open=false', () => {
    render(<TestToast open={false} />);
    expect(screen.queryByText('Toast title')).not.toBeInTheDocument();
  });

  it('renders default variant class', () => {
    render(<TestToast />);
    expect(getToastRoot()).toHaveClass('niuu-toast--default');
  });

  it('renders success variant class', () => {
    render(<TestToast variant="success" />);
    expect(getToastRoot()).toHaveClass('niuu-toast--success');
  });

  it('renders error variant class', () => {
    render(<TestToast variant="error" />);
    expect(getToastRoot()).toHaveClass('niuu-toast--error');
  });

  it('renders warning variant class', () => {
    render(<TestToast variant="warning" />);
    expect(getToastRoot()).toHaveClass('niuu-toast--warning');
  });

  it('calls onOpenChange(false) when close button clicked', async () => {
    const onOpenChange = vi.fn();
    render(<TestToast open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByText('✕'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders ToastAction with altText', () => {
    render(
      <ToastProvider duration={Infinity}>
        <Toast open>
          <ToastTitle>Title</ToastTitle>
          <ToastAction altText="Undo action">Undo</ToastAction>
        </Toast>
      </ToastProvider>,
    );
    expect(screen.getByText('Undo')).toBeInTheDocument();
  });

  it('ToastAction applies custom className', () => {
    render(
      <ToastProvider duration={Infinity}>
        <Toast open>
          <ToastTitle>T</ToastTitle>
          <ToastAction altText="act" className="my-action">
            Act
          </ToastAction>
        </Toast>
      </ToastProvider>,
    );
    expect(screen.getByText('Act')).toHaveClass('my-action');
  });

  it('ToastClose renders custom children', () => {
    render(
      <ToastProvider duration={Infinity}>
        <Toast open>
          <ToastTitle>T</ToastTitle>
          <ToastClose>Dismiss</ToastClose>
        </Toast>
      </ToastProvider>,
    );
    expect(screen.getByText('Dismiss')).toBeInTheDocument();
  });

  it('ToastClose applies custom className', () => {
    render(
      <ToastProvider duration={Infinity}>
        <Toast open>
          <ToastTitle>T</ToastTitle>
          <ToastClose className="x-btn">X</ToastClose>
        </Toast>
      </ToastProvider>,
    );
    expect(screen.getByText('X')).toHaveClass('x-btn');
  });

  it('Toast applies custom className', () => {
    render(
      <ToastProvider duration={Infinity}>
        <Toast open className="my-toast">
          <ToastTitle>T</ToastTitle>
        </Toast>
      </ToastProvider>,
    );
    expect(getToastRoot()).toHaveClass('my-toast');
  });

  it('ToastTitle applies custom className', () => {
    render(
      <ToastProvider duration={Infinity}>
        <Toast open>
          <ToastTitle className="my-title">T</ToastTitle>
        </Toast>
      </ToastProvider>,
    );
    expect(screen.getByText('T')).toHaveClass('my-title');
  });

  it('ToastDescription applies custom className', () => {
    render(
      <ToastProvider duration={Infinity}>
        <Toast open>
          <ToastTitle>T</ToastTitle>
          <ToastDescription className="my-desc">Desc</ToastDescription>
        </Toast>
      </ToastProvider>,
    );
    expect(screen.getByText('Desc')).toHaveClass('my-desc');
  });

  it('ToastViewport renders standalone', () => {
    render(
      <ToastProvider duration={Infinity}>
        <Toast open>
          <ToastTitle>T</ToastTitle>
        </Toast>
        <ToastViewport className="extra-viewport" />
      </ToastProvider>,
    );
    // ToastProvider already includes a viewport; this tests standalone rendering.
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it('ToastProvider with swipeDirection', () => {
    render(
      <ToastProvider swipeDirection="up" duration={Infinity}>
        <Toast open>
          <ToastTitle>Swipeable</ToastTitle>
        </Toast>
      </ToastProvider>,
    );
    expect(screen.getByText('Swipeable')).toBeInTheDocument();
  });
});
