import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { EditorPanel } from './EditorPanel';
import { resetEditorState } from './editorState';

// Mock the workbenchInit module — this is the new initialization module
import { markInitialized } from './editorState';

const mockInitWorkbench = vi.fn().mockImplementation(async (params: { sessionId: string }) => {
  markInitialized(params.sessionId);
});
vi.mock('./workbenchInit', () => ({
  initWorkbench: (...args: unknown[]) => mockInitWorkbench(...args),
}));

// jsdom doesn't support attachShadow natively — stub it
beforeEach(() => {
  if (!HTMLElement.prototype.attachShadow) {
    HTMLElement.prototype.attachShadow = function () {
      const frag = document.createDocumentFragment() as unknown as ShadowRoot;
      (frag as unknown as Record<string, unknown>).appendChild = this.appendChild.bind(this);
      return frag;
    };
  }
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

  it('calls initWorkbench with correct params', async () => {
    render(<EditorPanel hostname="pod.example.com" sessionId="session-123" />);

    await waitFor(() => {
      expect(mockInitWorkbench).toHaveBeenCalledTimes(1);
    });

    const params = mockInitWorkbench.mock.calls[0][0];
    expect(params.hostname).toBe('pod.example.com');
    expect(params.sessionId).toBe('session-123');
    expect(params.container).toBeInstanceOf(HTMLDivElement);
  });

  it('shows error state when initWorkbench fails', async () => {
    mockInitWorkbench.mockRejectedValueOnce(new Error('Failed to load workbench'));

    render(<EditorPanel hostname="pod.example.com" sessionId="session-123" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to initialize editor')).toBeInTheDocument();
    });

    expect(screen.getByText('Failed to load workbench')).toBeInTheDocument();
  });

  it('shows session-changed state when sessionId differs from initialized session', async () => {
    const { unmount } = render(<EditorPanel hostname="pod-1.example.com" sessionId="session-1" />);

    await waitFor(() => {
      expect(mockInitWorkbench).toHaveBeenCalledTimes(1);
    });

    unmount();

    render(<EditorPanel hostname="pod-2.example.com" sessionId="session-2" />);

    await waitFor(() => {
      expect(
        screen.getByText('Session changed — the editor requires a page reload to reconnect.')
      ).toBeInTheDocument();
    });

    expect(screen.getByText('Reload page')).toBeInTheDocument();
  });

  it('does not re-initialize when same session re-renders', async () => {
    const { rerender } = render(<EditorPanel hostname="pod.example.com" sessionId="session-123" />);

    await waitFor(() => {
      expect(mockInitWorkbench).toHaveBeenCalledTimes(1);
    });

    rerender(<EditorPanel hostname="pod.example.com" sessionId="session-123" />);

    // Should not call initWorkbench again
    expect(mockInitWorkbench).toHaveBeenCalledTimes(1);
  });

  it('renders the workbench container div', async () => {
    render(<EditorPanel hostname="pod.example.com" sessionId="session-123" />);

    await waitFor(() => {
      expect(mockInitWorkbench).toHaveBeenCalledTimes(1);
    });

    const params = mockInitWorkbench.mock.calls[0][0];
    expect(params.container).toBeInstanceOf(HTMLDivElement);
  });

  it('handles non-Error thrown from initWorkbench', async () => {
    mockInitWorkbench.mockRejectedValueOnce('string error');

    render(<EditorPanel hostname="pod.example.com" sessionId="session-123" />);

    await waitFor(() => {
      expect(screen.getByText('Failed to initialize editor')).toBeInTheDocument();
    });

    expect(screen.getByText('string error')).toBeInTheDocument();
  });
});
