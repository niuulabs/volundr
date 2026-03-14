import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EditorPanel } from './EditorPanel';
import { resetEditorState } from './editorState';

// Mock the monaco-vscode-api modules
const mockInitialize = vi.fn().mockResolvedValue(undefined);

vi.mock('@codingame/monaco-vscode-api', () => ({
  initialize: (...args: unknown[]) => mockInitialize(...args),
}));

vi.mock('@codingame/monaco-vscode-workbench-service-override', () => ({
  default: () => ({ workbench: true }),
}));

vi.mock('@codingame/monaco-vscode-remote-agent-service-override', () => ({
  default: () => ({ remoteAgent: true }),
}));

vi.mock('@codingame/monaco-vscode-terminal-service-override', () => ({
  default: () => ({ terminal: true }),
}));

// Mock getAccessToken
vi.mock('@/adapters/api/client', () => ({
  getAccessToken: vi.fn(() => 'test-jwt-token'),
}));

// Mock the editor adapter
vi.mock('@/adapters/api/editor.adapter', () => {
  class MockApiEditorAdapter {
    getWorkbenchConfig(_sessionId: string, hostname: string) {
      return {
        remoteAuthority: `${hostname}:8445`,
        wsUrl: `wss://${hostname}/reh/`,
      };
    }
  }
  return { ApiEditorAdapter: MockApiEditorAdapter };
});

describe('EditorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEditorState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders empty state when hostname is null', () => {
    render(<EditorPanel hostname={null} sessionId={null} />);

    expect(screen.getByText('Start a session to access the editor')).toBeInTheDocument();
  });

  it('renders empty state when sessionId is null', () => {
    render(<EditorPanel hostname="pod.example.com" sessionId={null} />);

    expect(screen.getByText('Start a session to access the editor')).toBeInTheDocument();
  });

  it('applies className prop to container', () => {
    const { container } = render(
      <EditorPanel hostname={null} sessionId={null} className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('calls initialize with correct service overrides', async () => {
    render(
      <EditorPanel hostname="pod.example.com" sessionId="session-123" />
    );

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    const [services, _container, config] = mockInitialize.mock.calls[0];

    expect(services).toEqual(
      expect.objectContaining({
        workbench: true,
        remoteAgent: true,
        terminal: true,
      })
    );

    expect(config.remoteAuthority).toBe('pod.example.com:8445');
    expect(config.webSocketFactory).toBeDefined();
    expect(config.webSocketFactory.create).toBeInstanceOf(Function);
  });

  it('shows status bar with Connected after successful init', async () => {
    render(
      <EditorPanel hostname="pod.example.com" sessionId="session-123" />
    );

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    expect(screen.getByText('pod.example.com')).toBeInTheDocument();
  });

  it('shows error state when initialize fails', async () => {
    mockInitialize.mockRejectedValueOnce(new Error('Failed to load workbench'));

    render(
      <EditorPanel hostname="pod.example.com" sessionId="session-123" />
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to initialize editor')).toBeInTheDocument();
    });

    expect(screen.getByText('Failed to load workbench')).toBeInTheDocument();
  });

  it('shows session-changed state when sessionId differs from initialized session', async () => {
    const { unmount } = render(
      <EditorPanel hostname="pod-1.example.com" sessionId="session-1" />
    );

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    unmount();

    render(
      <EditorPanel hostname="pod-2.example.com" sessionId="session-2" />
    );

    await waitFor(() => {
      expect(
        screen.getByText('Session changed — the editor requires a page reload to reconnect.')
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Reload page')).toBeInTheDocument();
  });

  it('does not re-initialize when same session re-renders', async () => {
    const { rerender } = render(
      <EditorPanel hostname="pod.example.com" sessionId="session-123" />
    );

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    rerender(
      <EditorPanel hostname="pod.example.com" sessionId="session-123" />
    );

    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    // Should not call initialize again
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it('renders the workbench container div', async () => {
    const { container } = render(
      <EditorPanel hostname="pod.example.com" sessionId="session-123" />
    );

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    const containerDiv = mockInitialize.mock.calls[0][1];
    expect(containerDiv).toBeInstanceOf(HTMLDivElement);
    expect(container.contains(containerDiv)).toBe(true);
  });

  it('webSocketFactory.create returns a WebSocket adapter', async () => {
    class MockWebSocket {
      url: string;
      protocols: string[];
      constructor(url: string, protocols: string[]) {
        this.url = url;
        this.protocols = protocols;
      }
      send = vi.fn();
      close = vi.fn();
      addEventListener = vi.fn();
    }
    vi.stubGlobal('WebSocket', MockWebSocket);

    render(
      <EditorPanel hostname="pod.example.com" sessionId="session-123" />
    );

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    const [, , config] = mockInitialize.mock.calls[0];
    const wsAdapter = config.webSocketFactory.create('wss://pod.example.com/reh/');

    expect(wsAdapter.send).toBeInstanceOf(Function);
    expect(wsAdapter.close).toBeInstanceOf(Function);
    expect(wsAdapter.onOpen).toBeInstanceOf(Function);
    expect(wsAdapter.onClose).toBeInstanceOf(Function);
    expect(wsAdapter.onMessage).toBeInstanceOf(Function);
    expect(wsAdapter.onError).toBeInstanceOf(Function);
    expect(wsAdapter.getProtocol()).toBe('vscode-reh');
  });

  it('handles non-Error thrown from initialize', async () => {
    mockInitialize.mockRejectedValueOnce('string error');

    render(
      <EditorPanel hostname="pod.example.com" sessionId="session-123" />
    );

    await waitFor(() => {
      expect(screen.getByText('Failed to initialize editor')).toBeInTheDocument();
    });

    expect(screen.getByText('string error')).toBeInTheDocument();
  });
});
