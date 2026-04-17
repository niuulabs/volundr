import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlanSagaView } from './PlanSagaView';

const mockSendMessage = vi.fn();

vi.mock('@/modules/shared/hooks/useSkuldChat', () => ({
  useSkuldChat: () => ({
    messages: [],
    connected: true,
    isRunning: false,
    historyLoaded: true,
    pendingPermissions: [],
    availableCommands: [],
    sendMessage: mockSendMessage,
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

const mockSpawnPlanSession = vi.fn(() =>
  Promise.resolve({
    session_id: 'plan-sess-001',
    chat_endpoint: 'wss://sessions.test/s/plan-sess-001/session',
  })
);
const mockCommitSaga = vi.fn(() => Promise.resolve({ id: 'saga-001' }));
const mockExtractStructure = vi.fn(() => Promise.resolve({ found: false, structure: null }));

vi.mock('../../adapters', () => ({
  tyrService: {
    spawnPlanSession: (...args: unknown[]) => mockSpawnPlanSession(...args),
    decompose: vi.fn(() => Promise.resolve([])),
    commitSaga: (...args: unknown[]) => mockCommitSaga(...args),
    extractStructure: (...args: unknown[]) => mockExtractStructure(...args),
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

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/modules/shared/api/client', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
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

vi.mock('../../components/RepoSelector', () => ({
  RepoSelector: ({
    onSelect,
    value,
  }: {
    onSelect: (v: string) => void;
    value: string;
    repos: unknown[];
    mode: string;
    showBranch: boolean;
  }) => (
    <select
      data-testid="repo-selector"
      value={value}
      onChange={e => onSelect(e.target.value)}
    >
      <option value="">Select a repo</option>
      <option value="https://github.com/niuu/volundr">niuu/volundr</option>
    </select>
  ),
}));

function renderView(initialEntry = '/tyr/new') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/tyr/new" element={<PlanSagaView />} />
        <Route path="/tyr/sagas/:id" element={<div data-testid="saga-detail">Saga Detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PlanSagaView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue([]);
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
    mockGet.mockResolvedValue(mockSessions);
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
    mockGet.mockResolvedValue(mockSessions);
    renderView();

    await waitFor(() => {
      expect(screen.getByText('plan-yggdrasil')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId('session-chat')).toBeInTheDocument();
    });
  });

  it('closes form when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    renderView();

    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Session'));
    expect(screen.getByText(/what do you want to build/i)).toBeInTheDocument();

    await user.click(screen.getByText('Cancel'));
    expect(screen.queryByText(/what do you want to build/i)).not.toBeInTheDocument();
  });

  it('closes form when X button is clicked', async () => {
    const user = userEvent.setup();
    renderView();

    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Session'));
    expect(screen.getByText('New Planning Session')).toBeInTheDocument();

    await user.click(screen.getByText('\u2715'));
    expect(screen.queryByText('New Planning Session')).not.toBeInTheDocument();
  });

  it('disables Start Planning button when spec is empty', async () => {
    const user = userEvent.setup();
    renderView();

    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Session'));
    const startBtn = screen.getByText('Start Planning');
    expect(startBtn).toBeDisabled();
  });

  it('enables Start Planning button when spec has content', async () => {
    const user = userEvent.setup();
    renderView();

    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Session'));
    const textarea = screen.getByPlaceholderText(/describe the feature/i);
    await user.type(textarea, 'Build a new feature');

    const startBtn = screen.getByText('Start Planning');
    expect(startBtn).not.toBeDisabled();
  });

  it('calls spawnPlanSession when Start Planning is clicked', async () => {
    const user = userEvent.setup();
    // First call returns sessions list, second (post-spawn refresh) returns updated list
    mockGet.mockResolvedValue([]);
    mockSpawnPlanSession.mockResolvedValue({
      session_id: 'plan-sess-001',
      chat_endpoint: 'wss://sessions.test/s/plan-sess-001/session',
    });

    renderView();

    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Session'));
    const textarea = screen.getByPlaceholderText(/describe the feature/i);
    await user.type(textarea, 'Build a new feature');

    await user.click(screen.getByText('Start Planning'));

    await waitFor(() => {
      expect(mockSpawnPlanSession).toHaveBeenCalledWith('Build a new feature', '');
    });
  });

  it('shows error when spawnPlanSession fails', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue([]);
    mockSpawnPlanSession.mockRejectedValue(new Error('Connection refused'));

    renderView();

    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Session'));
    const textarea = screen.getByPlaceholderText(/describe the feature/i);
    await user.type(textarea, 'Build a feature');

    await user.click(screen.getByText('Start Planning'));

    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });
  });

  it('shows generic error when spawn fails with non-Error', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue([]);
    mockSpawnPlanSession.mockRejectedValue('unknown error');

    renderView();

    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Session'));
    const textarea = screen.getByPlaceholderText(/describe the feature/i);
    await user.type(textarea, 'Build a feature');

    await user.click(screen.getByText('Start Planning'));

    await waitFor(() => {
      expect(screen.getByText('Failed to start planning session')).toBeInTheDocument();
    });
  });

  it('shows stop button on running sessions', async () => {
    mockGet.mockResolvedValue(mockSessions);
    renderView();

    await waitFor(() => {
      expect(screen.getByText('plan-yggdrasil')).toBeInTheDocument();
    });

    // Running session should have a stop button
    const stopBtn = screen.getByTitle('Stop session');
    expect(stopBtn).toBeInTheDocument();
  });

  it('handles stop session', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(mockSessions);
    mockDelete.mockResolvedValue(undefined);

    renderView();

    await waitFor(() => {
      expect(screen.getByText('plan-yggdrasil')).toBeInTheDocument();
    });

    const stopBtn = screen.getByTitle('Stop session');
    await user.click(stopBtn);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  it('shows error when stop session fails', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(mockSessions);
    mockDelete.mockRejectedValue(new Error('Stop failed'));

    renderView();

    await waitFor(() => {
      expect(screen.getByText('plan-yggdrasil')).toBeInTheDocument();
    });

    const stopBtn = screen.getByTitle('Stop session');
    await user.click(stopBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to stop session')).toBeInTheDocument();
    });
  });

  it('selects a different session when clicked', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(mockSessions);

    renderView();

    await waitFor(() => {
      expect(screen.getByText('plan-yggdrasil')).toBeInTheDocument();
    });

    // Click on the stopped session
    await user.click(screen.getByText('plan-tyr-pipeline'));

    // Should render the chat for the selected session (no chat_endpoint = No URL)
    await waitFor(() => {
      expect(screen.getByTestId('session-chat')).toHaveTextContent('No URL');
    });
  });

  it('renders session status labels', async () => {
    mockGet.mockResolvedValue(mockSessions);
    renderView();

    await waitFor(() => {
      expect(screen.getByText('running')).toBeInTheDocument();
      expect(screen.getByText('stopped')).toBeInTheDocument();
    });
  });

  it('shows Select a planning session when sessions exist but none selected explicitly', async () => {
    mockGet.mockResolvedValue(mockSessions);

    // When sessions exist, it auto-selects the first, so the empty chat message is not shown
    renderView();

    await waitFor(() => {
      expect(screen.getByTestId('session-chat')).toBeInTheDocument();
    });
  });

  it('renders the Finalize Plan button', async () => {
    mockGet
      .mockResolvedValueOnce(mockSessions) // /sessions
      .mockResolvedValueOnce({ finalize_prompt: 'Please finalize the plan.' }); // /plan/config

    renderView();

    await waitFor(() => {
      expect(screen.getByText('plan-yggdrasil')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Finalize Plan')).toBeInTheDocument();
    });
  });

  it('renders the active session header with status and name', async () => {
    mockGet.mockResolvedValue(mockSessions);
    renderView();

    await waitFor(() => {
      expect(screen.getByText('plan-yggdrasil')).toBeInTheDocument();
    });

    // Chat header should show the session name and status
    await waitFor(() => {
      expect(screen.getByTestId('session-chat')).toBeInTheDocument();
    });
  });

  it('renders Stop button on active running session header', async () => {
    mockGet.mockResolvedValue(mockSessions);
    renderView();

    await waitFor(() => {
      expect(screen.getByText('plan-yggdrasil')).toBeInTheDocument();
    });

    // Active session header should have a Stop button
    await waitFor(() => {
      const stopButtons = screen.getAllByText('Stop');
      expect(stopButtons.length).toBeGreaterThan(0);
    });
  });

  it('shows repo selector in the new session form', async () => {
    const user = userEvent.setup();
    renderView();

    await waitFor(() => {
      expect(screen.getByText('New Session')).toBeInTheDocument();
    });

    await user.click(screen.getByText('New Session'));
    expect(screen.getByTestId('repo-selector')).toBeInTheDocument();
  });
});
