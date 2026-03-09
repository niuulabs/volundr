import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { SessionTerminal } from './SessionTerminal';

// Mock xterm.js — jsdom has no canvas support
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    cols = 80;
    rows = 24;
    loadAddon = vi.fn();
    open = vi.fn();
    write = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    dispose = vi.fn();
  }
  return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => {
  class MockFitAddon {
    fit = vi.fn();
    dispose = vi.fn();
  }
  return { FitAddon: MockFitAddon };
});

vi.mock('@xterm/addon-web-links', () => {
  class MockWebLinksAddon {
    dispose = vi.fn();
  }
  return { WebLinksAddon: MockWebLinksAddon };
});

// Mock useWebSocket
vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: vi.fn(() => ({
    send: vi.fn(),
    sendJson: vi.fn(),
    close: vi.fn(),
    getSocket: vi.fn(() => null),
  })),
}));

// Mock useIsTouchDevice
vi.mock('@/hooks/useIsTouchDevice', () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

// Mock document.fonts.load
Object.defineProperty(document, 'fonts', {
  value: {
    load: vi.fn().mockResolvedValue([]),
  },
  writable: true,
  configurable: true,
});

import { useWebSocket } from '@/hooks/useWebSocket';

// jsdom lacks ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

describe('SessionTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with disconnected state when url is null', async () => {
    render(<SessionTerminal url={null} />);

    // Wait for font loading to resolve
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('renders with connected state when onOpen fires', async () => {
    let capturedCallbacks: Record<string, (...args: unknown[]) => void> = {};

    vi.mocked(useWebSocket).mockImplementation((_url, options = {}) => {
      capturedCallbacks = options as Record<string, (...args: unknown[]) => void>;
      return {
        send: vi.fn(),
        sendJson: vi.fn(),
        close: vi.fn(),
        getSocket: vi.fn(() => null),
      };
    });

    render(<SessionTerminal url="ws://test/terminal/ws" />);

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      capturedCallbacks.onOpen?.();
    });

    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('passes url to useWebSocket', async () => {
    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(useWebSocket).toHaveBeenCalledWith('ws://test-host/terminal/ws', expect.any(Object));
  });

  it('passes null url to useWebSocket when url is null', async () => {
    render(<SessionTerminal url={null} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(useWebSocket).toHaveBeenCalledWith(null, expect.any(Object));
  });

  it('applies className prop to wrapper', async () => {
    const { container } = render(<SessionTerminal url={null} className="custom-class" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders terminal tab bar', async () => {
    render(<SessionTerminal url={null} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByText('Terminal 1')).toBeInTheDocument();
  });

  it('adds a new tab when add button is clicked', async () => {
    render(<SessionTerminal url={null} />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: /new terminal/i }));

    expect(screen.getByText('Terminal 2')).toBeInTheDocument();
  });

  it('renders terminal container element', async () => {
    const { container } = render(<SessionTerminal url={null} />);

    await act(async () => {
      await Promise.resolve();
    });

    const terminalDiv = container.querySelector('[data-visible]');
    expect(terminalDiv).toBeTruthy();
  });
});
