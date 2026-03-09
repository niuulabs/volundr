import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TerminalAccessoryBar } from './TerminalAccessoryBar';

describe('TerminalAccessoryBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders key buttons', () => {
    render(<TerminalAccessoryBar onInput={vi.fn()} />);

    expect(screen.getByText('Esc')).toBeInTheDocument();
    expect(screen.getByText('Tab')).toBeInTheDocument();
    expect(screen.getByText('^C')).toBeInTheDocument();
    expect(screen.getByText('^D')).toBeInTheDocument();
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
  });

  it('calls onInput with the correct value when a key is pressed', () => {
    const onInput = vi.fn();
    render(<TerminalAccessoryBar onInput={onInput} />);

    fireEvent.click(screen.getByText('Esc'));
    expect(onInput).toHaveBeenCalledWith('\x1b');
  });

  it('sends control characters for ^C, ^D, ^Z, ^L', () => {
    const onInput = vi.fn();
    render(<TerminalAccessoryBar onInput={onInput} />);

    fireEvent.click(screen.getByText('^C'));
    expect(onInput).toHaveBeenCalledWith('\x03');

    fireEvent.click(screen.getByText('^D'));
    expect(onInput).toHaveBeenCalledWith('\x04');

    fireEvent.click(screen.getByText('^Z'));
    expect(onInput).toHaveBeenCalledWith('\x1a');

    fireEvent.click(screen.getByText('^L'));
    expect(onInput).toHaveBeenCalledWith('\x0c');
  });

  it('toggles Ctrl modifier on click', () => {
    const onInput = vi.fn();
    render(<TerminalAccessoryBar onInput={onInput} />);

    const ctrlBtn = screen.getByText('Ctrl');

    // Activate Ctrl
    fireEvent.click(ctrlBtn);
    expect(ctrlBtn.closest('button')).toHaveAttribute('data-active', 'true');

    // Deactivate Ctrl
    fireEvent.click(ctrlBtn);
    expect(ctrlBtn.closest('button')).not.toHaveAttribute('data-active', 'true');
  });

  it('auto-deactivates Ctrl after timeout', () => {
    render(<TerminalAccessoryBar onInput={vi.fn()} />);

    const ctrlBtn = screen.getByText('Ctrl');
    fireEvent.click(ctrlBtn);
    expect(ctrlBtn.closest('button')).toHaveAttribute('data-active', 'true');

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(ctrlBtn.closest('button')).not.toHaveAttribute('data-active', 'true');
  });

  it('sends arrow key escape sequences', () => {
    const onInput = vi.fn();
    render(<TerminalAccessoryBar onInput={onInput} />);

    // Up arrow
    fireEvent.click(screen.getByText('\u2191'));
    expect(onInput).toHaveBeenCalledWith('\x1b[A');

    // Down arrow
    fireEvent.click(screen.getByText('\u2193'));
    expect(onInput).toHaveBeenCalledWith('\x1b[B');
  });

  it('sends literal characters for pipe, tilde, dash, slash', () => {
    const onInput = vi.fn();
    render(<TerminalAccessoryBar onInput={onInput} />);

    fireEvent.click(screen.getByText('|'));
    expect(onInput).toHaveBeenCalledWith('|');

    fireEvent.click(screen.getByText('~'));
    expect(onInput).toHaveBeenCalledWith('~');

    fireEvent.click(screen.getByText('-'));
    expect(onInput).toHaveBeenCalledWith('-');

    fireEvent.click(screen.getByText('/'));
    expect(onInput).toHaveBeenCalledWith('/');
  });

  it('deactivates Ctrl after sending a modified key', () => {
    const onInput = vi.fn();
    render(<TerminalAccessoryBar onInput={onInput} />);

    // Activate Ctrl
    fireEvent.click(screen.getByText('Ctrl'));

    // Press a letter-like key with Ctrl active
    fireEvent.click(screen.getByText('/'));

    // Ctrl should be deactivated now
    const ctrlBtn = screen.getByText('Ctrl');
    expect(ctrlBtn.closest('button')).not.toHaveAttribute('data-active', 'true');
  });
});
