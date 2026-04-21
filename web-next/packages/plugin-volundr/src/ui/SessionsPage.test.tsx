import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { SessionsPage } from './SessionsPage';
import { createMockSessionStore } from '../adapters/mock';
import type { ISessionStore } from '../ports/ISessionStore';

// Mock TanStack Router navigate
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

function wrap(
  sessionStore: ISessionStore = createMockSessionStore(),
  pageProps: React.ComponentProps<typeof SessionsPage> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ sessionStore }}>
        <SessionsPage {...pageProps} />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Structural tests
// ---------------------------------------------------------------------------

describe('SessionsPage', () => {
  it('renders the sessions page container', () => {
    wrap();
    expect(screen.getByTestId('sessions-page')).toBeInTheDocument();
  });

  it('renders the sessions sidebar subnav', () => {
    wrap();
    expect(screen.getByTestId('sessions-subnav')).toBeInTheDocument();
  });

  it('renders the page header with title', () => {
    wrap();
    expect(screen.getByRole('heading', { name: /sessions/i })).toBeInTheDocument();
  });

  it('renders the search input', () => {
    wrap();
    expect(screen.getByTestId('session-search')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Sidebar — By Status section
  // ---------------------------------------------------------------------------

  it('renders By Status section in sidebar', () => {
    wrap();
    expect(screen.getByTestId('section-status')).toBeInTheDocument();
  });

  it('renders sidebar nodes for each session state', () => {
    wrap();
    expect(screen.getByTestId('sidebar-node-status-running')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-node-status-idle')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-node-status-provisioning')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-node-status-failed')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-node-status-terminated')).toBeInTheDocument();
  });

  it('defaults to running state selected in sidebar', () => {
    wrap();
    expect(screen.getByTestId('sidebar-node-status-running')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows session count badges in the sidebar', async () => {
    wrap();
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-node-status-running-count')).toHaveTextContent('1'),
    );
  });

  it('switches active filter when a sidebar node is clicked', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('sidebar-node-status-idle'));
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-node-status-idle')).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByTestId('sidebar-node-status-running')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  // ---------------------------------------------------------------------------
  // Sidebar — By Template section
  // ---------------------------------------------------------------------------

  it('renders By Template section in sidebar', () => {
    wrap();
    expect(screen.getByTestId('section-template')).toBeInTheDocument();
  });

  it('renders template sidebar nodes from session data', async () => {
    wrap();
    await waitFor(() =>
      expect(
        screen.getByTestId('sidebar-node-template-tpl-default'),
      ).toBeInTheDocument(),
    );
  });

  it('filters sessions by template when a template node is clicked', async () => {
    wrap();
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-node-template-tpl-default')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('sidebar-node-template-tpl-default'));
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-node-template-tpl-default')).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    // ds-1 is in tpl-default and should appear in the table
    await waitFor(() => expect(screen.getByText('ds-1')).toBeInTheDocument());
  });

  // ---------------------------------------------------------------------------
  // Sidebar — By Cluster section
  // ---------------------------------------------------------------------------

  it('renders By Cluster section in sidebar', () => {
    wrap();
    expect(screen.getByTestId('section-cluster')).toBeInTheDocument();
  });

  it('renders cluster sidebar nodes from session data', async () => {
    wrap();
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-node-cluster-cl-eitri')).toBeInTheDocument(),
    );
  });

  it('filters sessions by cluster when a cluster node is clicked', async () => {
    wrap();
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-node-cluster-cl-eitri')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('sidebar-node-cluster-cl-eitri'));
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-node-cluster-cl-eitri')).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    await waitFor(() => expect(screen.getByText('ds-1')).toBeInTheDocument());
  });

  // ---------------------------------------------------------------------------
  // Sidebar — collapsible sections
  // ---------------------------------------------------------------------------

  it('collapses the By Status section when toggle is clicked', () => {
    wrap();
    const toggle = screen.getByTestId('section-status-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar-node-status-running')).not.toBeInTheDocument();
  });

  it('expands a collapsed section when toggle is clicked again', () => {
    wrap();
    const toggle = screen.getByTestId('section-status-toggle');
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('sidebar-node-status-running')).toBeInTheDocument();
  });

  it('collapses the By Template section when toggle is clicked', async () => {
    wrap();
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-node-template-tpl-default')).toBeInTheDocument(),
    );
    const toggle = screen.getByTestId('section-template-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar-node-template-tpl-default')).not.toBeInTheDocument();
  });

  it('collapses the By Cluster section when toggle is clicked', async () => {
    wrap();
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-node-cluster-cl-eitri')).toBeInTheDocument(),
    );
    const toggle = screen.getByTestId('section-cluster-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar-node-cluster-cl-eitri')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Session list — data display
  // ---------------------------------------------------------------------------

  it('shows running sessions by default', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('ds-1')).toBeInTheDocument());
  });

  it('shows idle sessions when idle node is clicked', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('sidebar-node-status-idle'));
    await waitFor(() => expect(screen.getByText('ds-2')).toBeInTheDocument());
  });

  it('shows failed sessions when failed node is clicked', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('sidebar-node-status-failed'));
    await waitFor(() => expect(screen.getByText('ds-4')).toBeInTheDocument());
  });

  it('shows terminated sessions when terminated node is clicked', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('sidebar-node-status-terminated'));
    await waitFor(() => expect(screen.getByText('ds-5')).toBeInTheDocument());
  });

  it('shows provisioning sessions when provisioning node is clicked', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('sidebar-node-status-provisioning'));
    await waitFor(() => expect(screen.getByText('ds-3')).toBeInTheDocument());
  });

  it('shows a view button for each visible session', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('view-session-ds-1')).toBeInTheDocument());
  });

  // ---------------------------------------------------------------------------
  // Search / filter
  // ---------------------------------------------------------------------------

  it('filters visible sessions by search query matching session id', async () => {
    wrap();
    // switch to all-sessions view via template filter
    await waitFor(() =>
      expect(screen.getByTestId('sidebar-node-template-tpl-default')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('sidebar-node-template-tpl-default'));
    await waitFor(() => expect(screen.getByText('ds-1')).toBeInTheDocument());

    // Now type a search query that should only match ds-1
    fireEvent.change(screen.getByTestId('session-search'), { target: { value: 'ds-1' } });
    await waitFor(() => expect(screen.getByText('ds-1')).toBeInTheDocument());
    expect(screen.queryByText('ds-2')).not.toBeInTheDocument();
  });

  it('shows empty state when search produces no matches', async () => {
    wrap();
    fireEvent.change(screen.getByTestId('session-search'), {
      target: { value: 'zzz-no-match-at-all' },
    });
    await waitFor(() =>
      expect(screen.getByText(/No sessions match/i)).toBeInTheDocument(),
    );
  });

  it('shows empty state when no sessions match the selected state filter', async () => {
    const emptyStore: ISessionStore = {
      ...createMockSessionStore(),
      listSessions: vi.fn().mockResolvedValue([]),
    };
    wrap(emptyStore);
    await waitFor(() => expect(screen.getByText(/No sessions match/i)).toBeInTheDocument());
  });

  // ---------------------------------------------------------------------------
  // Issue link
  // ---------------------------------------------------------------------------

  it('does not render issue link when issueKey is not provided', () => {
    wrap();
    expect(screen.queryByTestId('issue-link')).not.toBeInTheDocument();
  });

  it('renders issue link in page header when issueKey is provided', () => {
    wrap(createMockSessionStore(), { issueKey: 'NIU-729' });
    const link = screen.getByTestId('issue-link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveTextContent('NIU-729');
  });

  it('uses issueUrl as href when provided', () => {
    wrap(createMockSessionStore(), {
      issueKey: 'NIU-729',
      issueUrl: 'https://linear.app/niuulabs/issue/NIU-729',
    });
    expect(screen.getByTestId('issue-link')).toHaveAttribute(
      'href',
      'https://linear.app/niuulabs/issue/NIU-729',
    );
  });

  it('falls back to # href when issueUrl is not provided', () => {
    wrap(createMockSessionStore(), { issueKey: 'NIU-729' });
    expect(screen.getByTestId('issue-link')).toHaveAttribute('href', '#');
  });

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------

  it('shows loading state before data resolves', () => {
    const slowStore: ISessionStore = {
      ...createMockSessionStore(),
      listSessions: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    wrap(slowStore);
    expect(screen.getByText('Loading sessions…')).toBeInTheDocument();
  });

  it('shows error state when session store fails', async () => {
    const failingStore: ISessionStore = {
      ...createMockSessionStore(),
      listSessions: vi.fn().mockRejectedValue(new Error('store failed')),
    };
    wrap(failingStore);
    await waitFor(() =>
      expect(screen.getByText('Failed to load sessions')).toBeInTheDocument(),
    );
  });
});
