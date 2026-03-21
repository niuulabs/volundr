import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SessionStartingIndicator } from './SessionStartingIndicator';

vi.mock('@/modules/volundr/components/atoms/OdinEye', () => ({
  OdinEye: () => <div data-testid="odin-eye" />,
}));

vi.mock('./SessionStartingIndicator.module.css', () => ({
  default: {
    container: 'container',
    eyeWrapper: 'eyeWrapper',
    eye: 'eye',
    label: 'label',
    message: 'message',
    messageFading: 'messageFading',
  },
}));

describe('SessionStartingIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the label text', () => {
    render(<SessionStartingIndicator />);
    expect(screen.getByText('Forging session…')).toBeInTheDocument();
  });

  it('renders the OdinEye atom', () => {
    render(<SessionStartingIndicator />);
    expect(screen.getByTestId('odin-eye')).toBeInTheDocument();
  });

  it('renders a forge message', () => {
    render(<SessionStartingIndicator />);

    // One of the forge messages should be present
    const forgeMessages = [
      'Igniting the forge fires…',
      'Summoning the Skuld pod…',
      'Shaping the workspace…',
      'Tempering the environment…',
      'Forging your session…',
      'Preparing the anvil…',
      'Stoking the bellows…',
      'Quenching the tools…',
      'Aligning the runes…',
      'Awakening the smith…',
    ];

    const found = forgeMessages.some(msg => screen.queryByText(msg) !== null);
    expect(found).toBe(true);
  });

  it('applies className prop', () => {
    const { container } = render(<SessionStartingIndicator className="custom-class" />);
    const root = container.firstElementChild;
    expect(root?.className).toContain('custom-class');
  });

  it('cycles messages on interval', () => {
    // Seed Math.random so the starting index is deterministic
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<SessionStartingIndicator />);

    // First message should be index 0
    expect(screen.getByText('Igniting the forge fires…')).toBeInTheDocument();

    // Advance past MESSAGE_DISPLAY_DURATION (3500ms) to trigger fade
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    // Advance past fade duration (400ms) to swap message
    act(() => {
      vi.advanceTimersByTime(400);
    });

    // Should now show index 1
    expect(screen.getByText('Summoning the Skuld pod…')).toBeInTheDocument();

    randomSpy.mockRestore();
  });

  it('cleans up timers on unmount', () => {
    const { unmount } = render(<SessionStartingIndicator />);

    // Advance partially into a cycle
    act(() => {
      vi.advanceTimersByTime(3500);
    });

    // Unmount during the fade — should not throw
    unmount();

    // Advance remaining timers — should be safe
    act(() => {
      vi.advanceTimersByTime(5000);
    });
  });
});
