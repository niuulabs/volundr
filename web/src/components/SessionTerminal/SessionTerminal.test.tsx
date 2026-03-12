import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
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

// Mock getAccessToken
vi.mock('@/adapters/api/client', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
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
import { useIsTouchDevice } from '@/hooks/useIsTouchDevice';

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
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders with disconnected state when url is null', async () => {
    render(<SessionTerminal url={null} />);

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

  it('sets connected=false on onClose', async () => {
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

    act(() => {
      capturedCallbacks.onClose?.();
    });
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('sets connected=false on onError', async () => {
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

    act(() => {
      capturedCallbacks.onError?.();
    });
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
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
  });

  it('renders empty terminal area when url is null', async () => {
    const { container } = render(<SessionTerminal url={null} />);

    await act(async () => {
      await Promise.resolve();
    });

    const terminalDiv = container.querySelector('[data-visible]');
    expect(terminalDiv).toBeNull();
  });

  it('loads existing sessions from server and creates tabs', async () => {
    const mockSessions = {
      sessions: [
        { terminalId: 'term-1', label: 'Shell 1', cli_type: 'shell', status: 'running' },
        { terminalId: 'term-2', label: 'Claude', cli_type: 'claude', status: 'running' },
      ],
    };

    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockSessions,
    });

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(screen.getByText('Shell 1')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
  });

  it('spawns initial shell when no existing sessions', async () => {
    // First call: listSessions returns empty
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessions: [] }),
    });
    // Second call: spawnSession returns new terminal
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ terminalId: 'shell-1', label: 'Shell 1' }),
    });

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(screen.getByText('Terminal 1')).toBeInTheDocument();
  });

  it('computes WebSocket URL from active tab', async () => {
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessions: [{ terminalId: 'my-term', label: 'Shell', cli_type: 'shell', status: 'running' }],
      }),
    });

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(useWebSocket).toHaveBeenCalledWith(
      'ws://test-host/terminal/ws/my-term',
      expect.any(Object)
    );
  });

  it('handles spawn failure gracefully', async () => {
    // listSessions returns empty
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessions: [] }),
    });
    // spawnSession fails
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Should not crash, just no tabs
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('handles listSessions fetch error gracefully', async () => {
    (globalThis.fetch as Mock).mockRejectedValueOnce(new Error('Network error'));

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Should not crash
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('handles onMessage with output event', async () => {
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

    // Should not crash when receiving output with no active terminal instance
    act(() => {
      capturedCallbacks.onMessage?.(JSON.stringify({ type: 'output', data: 'hello' }));
    });
  });

  it('handles onMessage with exit event', async () => {
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
      capturedCallbacks.onMessage?.(JSON.stringify({ type: 'exit', data: '' }));
    });
  });

  it('handles onMessage with invalid JSON (raw text)', async () => {
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

    // Should not crash on invalid JSON
    act(() => {
      capturedCallbacks.onMessage?.('not json at all');
    });
  });

  it('derives https base URL from wss WebSocket URL', async () => {
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessions: [] }),
    });
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ terminalId: 'shell-1', label: 'Shell' }),
    });

    render(<SessionTerminal url="wss://secure-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // The fetch should use https:// derived from wss://
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://secure-host/terminal/api/terminal/sessions',
      expect.any(Object)
    );
  });

  it('derives http base URL from ws WebSocket URL', async () => {
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessions: [] }),
    });
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ terminalId: 'shell-1', label: 'Shell' }),
    });

    render(<SessionTerminal url="ws://local-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://local-host/terminal/api/terminal/sessions',
      expect.any(Object)
    );
  });

  it('adds a new tab via CLI dropdown spawn', async () => {
    // Load existing sessions
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessions: [
          { terminalId: 'term-1', label: 'Shell 1', cli_type: 'shell', status: 'running' },
        ],
      }),
    });

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(screen.getByText('Shell 1')).toBeInTheDocument();

    // Mock the spawn response for adding a tab
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ terminalId: 'claude-1', label: 'Claude' }),
    });

    // Click the add button to open dropdown
    fireEvent.click(screen.getByRole('button', { name: /new terminal/i }));
    // Click Claude option
    fireEvent.click(screen.getByRole('menuitem', { name: /claude/i }));

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(screen.getByText('Claude')).toBeInTheDocument();
  });

  it('closes a tab and switches to adjacent tab', async () => {
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessions: [
          { terminalId: 'term-1', label: 'Tab 1', cli_type: 'shell', status: 'running' },
          { terminalId: 'term-2', label: 'Tab 2', cli_type: 'shell', status: 'running' },
        ],
      }),
    });

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(screen.getByText('Tab 1')).toBeInTheDocument();
    expect(screen.getByText('Tab 2')).toBeInTheDocument();

    // Mock the kill fetch call
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    });

    // Close first tab
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    fireEvent.click(closeButtons[0]);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('Tab 1')).toBeNull();
    expect(screen.getByText('Tab 2')).toBeInTheDocument();
  });

  it('shows touch accessory bar on touch devices', async () => {
    vi.mocked(useIsTouchDevice).mockReturnValue(true);

    render(<SessionTerminal url={null} />);

    await act(async () => {
      await Promise.resolve();
    });

    // The accessory bar should be rendered for touch devices
    // It renders Tab, Ctrl, Esc buttons
    expect(screen.getByText('Tab')).toBeInTheDocument();
  });

  it('handles non-ok listSessions response', async () => {
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Should not crash, no tabs
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('selects a tab when clicked', async () => {
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessions: [
          { terminalId: 'term-1', label: 'Tab 1', cli_type: 'shell', status: 'running' },
          { terminalId: 'term-2', label: 'Tab 2', cli_type: 'shell', status: 'running' },
        ],
      }),
    });

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Click on the second tab
    fireEvent.click(screen.getByText('Tab 2'));

    // The second tab should now be active (aria-selected)
    const allTabs = screen.getAllByRole('tab');
    expect(allTabs[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('does not close the last remaining tab', async () => {
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        sessions: [
          { terminalId: 'term-1', label: 'Only Tab', cli_type: 'shell', status: 'running' },
        ],
      }),
    });

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // With only one tab, close buttons should not be visible
    expect(screen.queryAllByRole('button', { name: /close/i })).toHaveLength(0);
  });

  it('handles spawn network error gracefully', async () => {
    (globalThis.fetch as Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sessions: [] }),
    });
    // spawnSession network error
    (globalThis.fetch as Mock).mockRejectedValueOnce(new Error('fetch failed'));

    render(<SessionTerminal url="ws://test-host/terminal/ws" />);

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Should not crash
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
