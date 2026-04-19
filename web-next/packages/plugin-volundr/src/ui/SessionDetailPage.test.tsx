import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { SessionDetailPage } from './SessionDetailPage';
import {
  createMockFileSystemPort,
  createMockSessionStore,
  createMockMetricsStream,
} from '../adapters/mock';
import type { IPtyStream } from '../ports/IPtyStream';
import type { IFileSystemPort } from '../ports/IFileSystemPort';
import type { ISessionStore } from '../ports/ISessionStore';
import type { IMetricsStream } from '../ports/IMetricsStream';

// ---------------------------------------------------------------------------
// Mock xterm (no Canvas in jsdom)
// ---------------------------------------------------------------------------

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    loadAddon: vi.fn(),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    options: {},
  })),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('shiki', () => ({
  codeToHtml: vi.fn().mockResolvedValue('<pre><code>highlighted</code></pre>'),
}));

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPtyStream(overrides?: Partial<IPtyStream>): IPtyStream {
  return {
    subscribe: vi.fn().mockReturnValue(() => {}),
    send: vi.fn(),
    ...overrides,
  };
}

function buildFilesystem(overrides?: Partial<IFileSystemPort>): IFileSystemPort {
  const base = createMockFileSystemPort();
  return { ...base, ...overrides };
}

function wrap(
  ui: React.ReactNode,
  {
    ptyStream = buildPtyStream(),
    filesystem = buildFilesystem(),
    sessionStore = createMockSessionStore(),
    metricsStream = createMockMetricsStream(),
  }: {
    ptyStream?: IPtyStream;
    filesystem?: IFileSystemPort;
    sessionStore?: ISessionStore;
    metricsStream?: IMetricsStream;
  } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ ptyStream, filesystem, sessionStore, metricsStream }}>
        {ui}
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionDetailPage', () => {
  it('renders the session id in the header', () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    expect(screen.getByTestId('session-id-label')).toHaveTextContent('ds-1');
  });

  it('shows the archived badge in readOnly mode', () => {
    wrap(<SessionDetailPage sessionId="ds-1" readOnly />);
    expect(screen.getByTestId('session-archived-badge')).toBeInTheDocument();
  });

  it('does NOT show the archived badge in interactive mode', () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    expect(screen.queryByTestId('session-archived-badge')).not.toBeInTheDocument();
  });

  it('renders all six tab buttons', () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByTestId('tab-terminal')).toBeInTheDocument();
    expect(screen.getByTestId('tab-files')).toBeInTheDocument();
    expect(screen.getByTestId('tab-exec')).toBeInTheDocument();
    expect(screen.getByTestId('tab-events')).toBeInTheDocument();
    expect(screen.getByTestId('tab-metrics')).toBeInTheDocument();
  });

  it('defaults to the overview tab', () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    expect(screen.getByTestId('tab-overview')).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to the terminal tab on click', async () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    fireEvent.click(screen.getByTestId('tab-terminal'));
    expect(screen.getByTestId('tab-terminal')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByTestId('terminal-container')).toBeInTheDocument());
  });

  it('switches to the files tab on click', async () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    fireEvent.click(screen.getByTestId('tab-files'));
    expect(screen.getByTestId('tab-files')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByTestId('filetree-root')).toBeInTheDocument());
  });

  it('switches to the exec tab on click', () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    fireEvent.click(screen.getByTestId('tab-exec'));
    expect(screen.getByTestId('exec-tab')).toBeInTheDocument();
    expect(screen.getByTestId('exec-empty')).toBeInTheDocument();
  });

  it('switches to the events tab on click', async () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    fireEvent.click(screen.getByTestId('tab-events'));
    await waitFor(() => expect(screen.getByTestId('events-tab')).toBeInTheDocument());
  });

  it('switches to the metrics tab on click', () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    fireEvent.click(screen.getByTestId('tab-metrics'));
    expect(screen.getByTestId('metrics-tab')).toBeInTheDocument();
  });

  it('shows overview content with session state after loading', async () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    await waitFor(() => expect(screen.getByTestId('overview-tab')).toBeInTheDocument());
  });

  it('shows events in the events tab', async () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    fireEvent.click(screen.getByTestId('tab-events'));
    await waitFor(() => expect(screen.getAllByTestId('event-row').length).toBeGreaterThan(0));
  });

  it('shows exec input and run button in exec tab', () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    fireEvent.click(screen.getByTestId('tab-exec'));
    expect(screen.getByTestId('exec-input')).toBeInTheDocument();
    expect(screen.getByTestId('exec-run-btn')).toBeInTheDocument();
  });

  it('run button is disabled when input is empty', () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    fireEvent.click(screen.getByTestId('tab-exec'));
    expect(screen.getByTestId('exec-run-btn')).toBeDisabled();
  });

  it('run button is enabled when command is typed', () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    fireEvent.click(screen.getByTestId('tab-exec'));
    fireEvent.change(screen.getByTestId('exec-input'), { target: { value: 'ls -la' } });
    expect(screen.getByTestId('exec-run-btn')).not.toBeDisabled();
  });

  it('shows a lifecycle badge for known sessions', async () => {
    wrap(<SessionDetailPage sessionId="ds-1" />);
    // The LifecycleBadge renders a span with the state name as text content.
    await waitFor(() => expect(screen.getByTestId('overview-tab')).toBeInTheDocument());
    // Badge text 'running' appears in the overview tab header.
    expect(screen.getAllByText('running').length).toBeGreaterThan(0);
  });

  it('shows error state when session store rejects', async () => {
    const failingStore: ISessionStore = {
      ...createMockSessionStore(),
      getSession: vi.fn().mockRejectedValue(new Error('store error')),
    };
    wrap(<SessionDetailPage sessionId="ds-1" />, { sessionStore: failingStore });
    await waitFor(() => expect(screen.getByText('Failed to load session')).toBeInTheDocument());
  });
});

describe('ExecTab integration', () => {
  it('appends an exec entry on submit and shows it', async () => {
    const ptyStream = buildPtyStream({
      subscribe: vi.fn((_, cb) => {
        // Simulate immediate output with shell prompt.
        setTimeout(() => cb('output\r\n$ '), 10);
        return () => {};
      }),
      send: vi.fn(),
    });

    wrap(<SessionDetailPage sessionId="ds-1" />, { ptyStream });
    fireEvent.click(screen.getByTestId('tab-exec'));

    fireEvent.change(screen.getByTestId('exec-input'), { target: { value: 'echo hello' } });
    fireEvent.click(screen.getByTestId('exec-run-btn'));

    await waitFor(() => expect(screen.getByTestId('exec-entry')).toBeInTheDocument());
    expect(screen.getByText(/echo hello/)).toBeInTheDocument();
  });
});
