import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { LoadingIndicator } from './LoadingIndicator';

const TEST_MESSAGES = ['Message one', 'Message two', 'Message three'];

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LoadingIndicator', () => {
  it('renders the first message', () => {
    render(<LoadingIndicator messages={TEST_MESSAGES} />);
    expect(screen.getByText('Message one')).toBeInTheDocument();
  });

  it('cycles to the next message after interval', () => {
    render(<LoadingIndicator messages={TEST_MESSAGES} />);
    expect(screen.getByText('Message one')).toBeInTheDocument();

    // Trigger cycle (default 3500ms interval)
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    // After fade-out timeout (400ms), text swaps
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText('Message two')).toBeInTheDocument();
  });

  it('wraps around to first message after last', () => {
    render(<LoadingIndicator messages={TEST_MESSAGES} />);

    // Cycle through all messages
    for (let i = 0; i < 3; i++) {
      act(() => {
        vi.advanceTimersByTime(3500);
      });
      act(() => {
        vi.advanceTimersByTime(400);
      });
    }

    expect(screen.getByText('Message one')).toBeInTheDocument();
  });

  it('respects custom displayDuration', () => {
    render(<LoadingIndicator messages={TEST_MESSAGES} displayDuration={1000} />);

    // Should not cycle at 999ms
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByText('Message one')).toBeInTheDocument();

    // Trigger cycle at 1000ms
    act(() => {
      vi.advanceTimersByTime(1);
    });

    // Wait for fade
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByText('Message two')).toBeInTheDocument();
  });

  it('does not cycle with a single message', () => {
    render(<LoadingIndicator messages={['Only one']} />);

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(screen.getByText('Only one')).toBeInTheDocument();
  });

  it('cleans up timers on unmount', () => {
    const { unmount } = render(<LoadingIndicator messages={TEST_MESSAGES} />);

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

  it('applies custom className', () => {
    const { container } = render(<LoadingIndicator messages={TEST_MESSAGES} className="custom" />);
    expect(container.firstChild).toHaveClass('custom');
  });

  // ── Inline variant ──

  it('renders inline variant by default', () => {
    const { container } = render(<LoadingIndicator messages={TEST_MESSAGES} />);
    expect(container.querySelector('[class*="inline"]')).toBeInTheDocument();
  });

  it('renders icon in inline variant', () => {
    render(<LoadingIndicator messages={TEST_MESSAGES} icon={<div data-testid="test-icon" />} />);
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  // ── Centered variant ──

  it('renders centered variant', () => {
    const { container } = render(<LoadingIndicator messages={TEST_MESSAGES} variant="centered" />);
    expect(container.querySelector('[class*="centered"]')).toBeInTheDocument();
  });

  it('renders label in centered variant', () => {
    render(<LoadingIndicator messages={TEST_MESSAGES} variant="centered" label="Loading..." />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders icon in centered variant', () => {
    render(
      <LoadingIndicator
        messages={TEST_MESSAGES}
        variant="centered"
        icon={<div data-testid="centered-icon" />}
      />
    );
    expect(screen.getByTestId('centered-icon')).toBeInTheDocument();
  });

  it('does not render label when not provided', () => {
    render(<LoadingIndicator messages={TEST_MESSAGES} variant="centered" />);
    const labels = document.querySelectorAll('[class*="label"]');
    expect(labels.length).toBe(0);
  });
});
