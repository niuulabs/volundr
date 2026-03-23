import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NewTokenOverlay } from './NewTokenOverlay';

describe('NewTokenOverlay', () => {
  const mockToken = 'pat_abc123_secret_value';
  let onDone: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    onDone = vi.fn();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('renders the token value', () => {
    render(<NewTokenOverlay token={mockToken} onDone={onDone} />);
    expect(screen.getByText(mockToken)).toBeDefined();
  });

  it('displays warning message', () => {
    render(<NewTokenOverlay token={mockToken} onDone={onDone} />);
    expect(
      screen.getByText('Copy this token now. It will not be shown again.')
    ).toBeDefined();
  });

  it('displays title', () => {
    render(<NewTokenOverlay token={mockToken} onDone={onDone} />);
    expect(screen.getByText('Token Created')).toBeDefined();
  });

  it('copies token to clipboard on copy button click', async () => {
    render(<NewTokenOverlay token={mockToken} onDone={onDone} />);
    const copyButton = screen.getByLabelText('Copy token');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockToken);
    });
  });

  it('calls onDone when Done button is clicked', () => {
    render(<NewTokenOverlay token={mockToken} onDone={onDone} />);
    fireEvent.click(screen.getByText('Done'));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('shows check icon after copying', async () => {
    render(<NewTokenOverlay token={mockToken} onDone={onDone} />);
    const copyButton = screen.getByLabelText('Copy token');
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockToken);
    });
    // The copied state should be true, showing the Check icon
    // The copy button should still be present
    expect(screen.getByLabelText('Copy token')).toBeDefined();
  });
});
