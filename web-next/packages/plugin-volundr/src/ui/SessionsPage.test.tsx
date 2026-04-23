import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { SessionsPage } from './SessionsPage';
import {
  createMockSessionStore,
  createMockPtyStream,
  createMockFileSystemPort,
} from '../adapters/mock';
import type { ISessionStore } from '../ports/ISessionStore';

// ---------------------------------------------------------------------------
// Mock xterm + shiki (SessionDetailPage embeds terminal)
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

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ sessionId: 'ds-1' }),
}));

function wrap(sessionStore: ISessionStore = createMockSessionStore()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider
        services={{
          sessionStore,
          ptyStream: createMockPtyStream(),
          filesystem: createMockFileSystemPort(),
        }}
      >
        <SessionsPage />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionsPage', () => {
  it('renders the sessions page container', () => {
    wrap();
    expect(screen.getByTestId('sessions-page')).toBeInTheDocument();
  });

  it('renders the pod list sidebar', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('pod-list-sidebar')).toBeInTheDocument());
  });

  it('renders sidebar header with Pods title', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Pods')).toBeInTheDocument());
  });

  it('renders session count badge', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('pod-count')).toBeInTheDocument());
  });

  it('renders search input in sidebar', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('pod-search')).toBeInTheDocument());
  });

  it('renders ACTIVE group with running sessions', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('pod-group-active')).toBeInTheDocument());
  });

  it('renders BOOTING group with provisioning sessions', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('pod-group-booting')).toBeInTheDocument());
  });

  it('renders ERROR group with failed sessions', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('pod-group-error')).toBeInTheDocument());
  });

  it('renders pod entries for running sessions', async () => {
    wrap();
    await waitFor(() =>
      expect(screen.getByTestId('pod-entry-laptop-volundr-local')).toBeInTheDocument(),
    );
  });

  it('auto-selects the first running session and shows detail page', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('session-detail-page')).toBeInTheDocument());
  });

  it('switches detail view when clicking a different session', async () => {
    wrap();
    await waitFor(() =>
      expect(screen.getByTestId('pod-entry-mimir-bge-reindex')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('pod-entry-mimir-bge-reindex'));
    await waitFor(() => expect(screen.getByTestId('session-detail-page')).toBeInTheDocument());
  });

  it('filters sidebar entries by search query', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('pod-search')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('pod-search'), { target: { value: 'mimir' } });
    await waitFor(() =>
      expect(screen.getByTestId('pod-entry-mimir-bge-reindex')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('pod-entry-ds-1')).not.toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    const slowStore: ISessionStore = {
      ...createMockSessionStore(),
      listSessions: () => new Promise(() => {}),
    };
    wrap(slowStore);
    expect(screen.getByText(/loading sessions/i)).toBeInTheDocument();
  });

  it('renders connection type badges on sessions', async () => {
    wrap();
    await waitFor(() =>
      expect(screen.getByTestId('pod-entry-laptop-volundr-local')).toBeInTheDocument(),
    );
    const badges = screen.getAllByTestId('connection-type-badge');
    expect(badges.length).toBeGreaterThan(0);
  });
});
