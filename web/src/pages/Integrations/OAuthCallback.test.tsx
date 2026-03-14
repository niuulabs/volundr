import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OAuthCallback } from './OAuthCallback';

describe('OAuthCallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders connected message', () => {
    render(<OAuthCallback />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('This window will close automatically.')).toBeInTheDocument();
  });

  it('calls window.close after timeout', () => {
    vi.useFakeTimers();
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

    render(<OAuthCallback />);

    vi.advanceTimersByTime(2000);
    expect(closeSpy).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });
});
