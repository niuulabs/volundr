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

function wrap(sessionStore: ISessionStore = createMockSessionStore()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ sessionStore }}>{<SessionsPage />}</ServicesProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SessionsPage', () => {
  it('renders the sessions page container', () => {
    wrap();
    expect(screen.getByTestId('sessions-page')).toBeInTheDocument();
  });

  it('renders state subnav tabs', () => {
    wrap();
    expect(screen.getByTestId('state-tab-running')).toBeInTheDocument();
    expect(screen.getByTestId('state-tab-idle')).toBeInTheDocument();
    expect(screen.getByTestId('state-tab-provisioning')).toBeInTheDocument();
    expect(screen.getByTestId('state-tab-failed')).toBeInTheDocument();
    expect(screen.getByTestId('state-tab-terminated')).toBeInTheDocument();
  });

  it('defaults to the running tab selected', () => {
    wrap();
    expect(screen.getByTestId('state-tab-running')).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to idle tab on click', () => {
    wrap();
    fireEvent.click(screen.getByTestId('state-tab-idle'));
    expect(screen.getByTestId('state-tab-idle')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('state-tab-running')).toHaveAttribute('aria-selected', 'false');
  });

  it('shows running sessions in the running tab', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('ds-1')).toBeInTheDocument());
  });

  it('shows session counts in tab badges', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('state-count-running')).toHaveTextContent('1'));
  });

  it('shows empty state when no sessions match the selected state', async () => {
    const emptyStore: ISessionStore = {
      ...createMockSessionStore(),
      listSessions: vi.fn().mockResolvedValue([]),
    };
    wrap(emptyStore);
    await waitFor(() => expect(screen.getByText(/No running sessions/i)).toBeInTheDocument());
  });

  it('shows failed sessions when failed tab is clicked', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('state-tab-failed'));
    await waitFor(() => expect(screen.getByText('ds-4')).toBeInTheDocument());
  });

  it('shows terminated sessions when terminated tab is clicked', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('state-tab-terminated'));
    await waitFor(() => expect(screen.getByText('ds-5')).toBeInTheDocument());
  });

  it('shows provisioning sessions when provisioning tab is clicked', async () => {
    wrap();
    fireEvent.click(screen.getByTestId('state-tab-provisioning'));
    await waitFor(() => expect(screen.getByText('ds-3')).toBeInTheDocument());
  });

  it('shows error state when session store fails', async () => {
    const failingStore: ISessionStore = {
      ...createMockSessionStore(),
      listSessions: vi.fn().mockRejectedValue(new Error('store failed')),
    };
    wrap(failingStore);
    await waitFor(() => expect(screen.getByText('Failed to load sessions')).toBeInTheDocument());
  });

  it('shows loading state before data resolves', () => {
    const slowStore: ISessionStore = {
      ...createMockSessionStore(),
      listSessions: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    wrap(slowStore);
    expect(screen.getByText('Loading sessions…')).toBeInTheDocument();
  });

  it('shows a view button for each visible session', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('view-session-ds-1')).toBeInTheDocument());
  });
});
