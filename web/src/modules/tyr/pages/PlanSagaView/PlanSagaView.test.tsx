import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlanSagaView } from './PlanSagaView';

vi.mock('@/modules/shared/hooks/useSkuldChat', () => ({
  useSkuldChat: () => ({
    messages: [],
    connected: true,
    isRunning: false,
    historyLoaded: true,
    pendingPermissions: [],
    availableCommands: [],
    sendMessage: vi.fn(),
    respondToPermission: vi.fn(),
    sendInterrupt: vi.fn(),
    sendSetModel: vi.fn(),
    sendSetMaxThinkingTokens: vi.fn(),
    sendRewindFiles: vi.fn(),
    clearMessages: vi.fn(),
  }),
}));

vi.mock('@/modules/shared/components/SessionChat', () => ({
  SessionChat: ({ url }: { url: string | null }) => (
    <div data-testid="session-chat">{url ? `Connected to ${url}` : 'No URL'}</div>
  ),
}));

vi.mock('../../adapters', () => ({
  tyrService: {
    spawnPlanSession: vi.fn(() =>
      Promise.resolve({
        session_id: 'plan-sess-001',
        chat_endpoint: 'wss://sessions.test/s/plan-sess-001/session',
      })
    ),
    decompose: vi.fn(() => Promise.resolve([])),
    commitSaga: vi.fn(() => Promise.resolve({ id: 'saga-001' })),
    extractStructure: vi.fn(() => Promise.resolve({ found: false, structure: null })),
  },
}));

const mockSessions = [
  {
    id: 'sess-1',
    name: 'plan-yggdrasil',
    model: 'claude-sonnet-4-6',
    status: 'running',
    chat_endpoint: 'wss://sessions.test/s/sess-1/session',
    task_type: 'planner',
    source: { type: 'git', repo: 'niuu/volundr', branch: 'plan-ygg', base_branch: 'main' },
  },
  {
    id: 'sess-2',
    name: 'plan-tyr-pipeline',
    model: 'claude-sonnet-4-6',
    status: 'stopped',
    chat_endpoint: null,
    task_type: 'planner',
  },
];

const mockFetch = vi.fn();

vi.mock('@/modules/shared/api/client', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockFetch(...args),
    post: vi.fn(),
    delete: vi.fn(),
  }),
  getAccessToken: () => 'test-token',
}));

const mockRepos = [
  {
    provider: 'github',
    org: 'niuu',
    name: 'volundr',
    clone_url: 'https://github.com/niuu/volundr.git',
    url: 'https://github.com/niuu/volundr',
    default_branch: 'main',
    branches: ['main', 'dev'],
  },
];

vi.mock('../../hooks/useRepos', () => ({
  useRepos: () => ({
    repos: mockRepos,
    loading: false,
    error: null,
  }),
}));

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/tyr/new']}>
      <Routes>
        <Route path="/tyr/new" element={<PlanSagaView />} />
        <Route path="/tyr/sagas/:id" element={<div>Saga Detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PlanSagaView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue([]);
  });

  it('renders the planning heading', async () => {
    renderView();
    expect(screen.getByText('Planning')).toBeInTheDocument();
  });

  it('shows new session button', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });
  });

  it('shows empty state when no sessions', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText(/no planning sessions yet/i)).toBeInTheDocument();
    });
  });

  it('renders session list when sessions exist', async () => {
    mockFetch.mockResolvedValue(mockSessions);
    renderView();

    await waitFor(() => {
      expect(screen.getByText('plan-yggdrasil')).toBeInTheDocument();
      expect(screen.getByText('plan-tyr-pipeline')).toBeInTheDocument();
    });
  });

  it('shows new session form when button clicked', async () => {
    const user = userEvent.setup();
    renderView();

    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Session'));

    expect(screen.getByText(/what do you want to build/i)).toBeInTheDocument();
  });

  it('auto-selects first session when sessions load', async () => {
    mockFetch.mockResolvedValue(mockSessions);
    renderView();

    await waitFor(() => {
      expect(screen.getByText('plan-yggdrasil')).toBeInTheDocument();
    });

    // The component auto-selects the most recent session
    await waitFor(() => {
      expect(screen.getByTestId('session-chat')).toBeInTheDocument();
    });
  });
});
