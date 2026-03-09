import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ChatLoadingIndicator } from './ChatLoadingIndicator';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ChatLoadingIndicator', () => {
  it('renders a viking fact', () => {
    render(<ChatLoadingIndicator />);
    expect(screen.getByText('Odin sacrificed his eye for wisdom')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<ChatLoadingIndicator className="custom" />);
    expect(container.firstChild).toHaveClass('custom');
  });

  it('cycles to the next fact after interval', () => {
    render(<ChatLoadingIndicator />);
    expect(screen.getByText('Odin sacrificed his eye for wisdom')).toBeInTheDocument();

    // Trigger cycle (3500ms interval)
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    // After fade-out timeout (400ms), text swaps
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText('Vikings never wore horned helmets')).toBeInTheDocument();
  });

  it('cleans up timers on unmount', () => {
    const { unmount } = render(<ChatLoadingIndicator />);

    // Start a cycle
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    // Unmount while timeout is pending
    unmount();

    // Should not throw
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  });

  it('handles cleanup when no timer is active', () => {
    const { unmount } = render(<ChatLoadingIndicator />);
    unmount();
    // timerRef.current is null, cleanup should still work
  });
});
