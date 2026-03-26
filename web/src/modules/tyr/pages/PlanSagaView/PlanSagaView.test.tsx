import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlanSagaView } from './PlanSagaView';

const mockSendMessage = vi.fn();
const mockSkuldMessages: Array<{
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  status: string;
}> = [];

vi.mock('@/modules/shared/hooks/useSkuldChat', () => ({
  useSkuldChat: () => ({
    messages: mockSkuldMessages,
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

const mockPlanSession = {
  session_id: 'plan-sess-001',
  chat_endpoint: 'wss://sessions.test/s/plan-sess-001/session',
};

vi.mock('../../adapters', () => ({
  tyrService: {
    spawnPlanSession: vi.fn(() => Promise.resolve({ ...mockPlanSession })),
    decompose: vi.fn(() => Promise.resolve([])),
    commitSaga: vi.fn(() => Promise.resolve({ id: 'saga-001' })),
    extractStructure: vi.fn(() => Promise.resolve({ found: false, structure: null })),
  },
}));

function renderView() {
  return render(
    <MemoryRouter initialEntries={['/tyr/plan']}>
      <Routes>
        <Route path="/tyr/plan" element={<PlanSagaView />} />
        <Route path="/tyr/sagas/:id" element={<div>Saga Detail</div>} />
        <Route path="/tyr/new" element={<div>New Saga</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function spawnSession(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/specification/i), 'Build auth');
  await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
  await user.click(screen.getByRole('button', { name: /start planning session/i }));
  await waitFor(() => {
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });
}

describe('PlanSagaView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSkuldMessages.length = 0;
  });

  it('renders the initial form', () => {
    renderView();

    expect(screen.getByText('Plan Saga')).toBeInTheDocument();
    expect(screen.getByLabelText(/specification/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/repository/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start planning session/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /one-shot decompose/i })).toBeInTheDocument();
  });

  it('disables buttons when spec or repo is empty', () => {
    renderView();

    const spawnBtn = screen.getByRole('button', { name: /start planning session/i });
    const decomposeBtn = screen.getByRole('button', { name: /one-shot decompose/i });

    expect(spawnBtn).toBeDisabled();
    expect(decomposeBtn).toBeDisabled();
  });

  it('enables buttons when spec and repo are filled', async () => {
    const user = userEvent.setup();
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');

    const spawnBtn = screen.getByRole('button', { name: /start planning session/i });
    expect(spawnBtn).not.toBeDisabled();
  });

  it('spawns a planning session via tyrService', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    renderView();

    await spawnSession(user);

    expect(tyrService.spawnPlanSession).toHaveBeenCalledWith('Build auth', 'niuu/volundr');
  });

  it('shows SessionChat after spawning session', async () => {
    const user = userEvent.setup();
    renderView();

    await spawnSession(user);

    const chat = screen.getByTestId('session-chat');
    expect(chat).toHaveTextContent('Connected to wss://sessions.test/s/plan-sess-001/session');
  });

  it('shows error on spawn failure', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    vi.mocked(tyrService.spawnPlanSession).mockRejectedValueOnce(
      new Error('Volundr unreachable')
    );
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(screen.getByText(/volundr unreachable/i)).toBeInTheDocument();
    });
  });

  it('shows fallback error message on spawn non-Error throw', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    vi.mocked(tyrService.spawnPlanSession).mockRejectedValueOnce('string error');
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to spawn planning session/i)).toBeInTheDocument();
    });
  });

  it('shows session status and repo after spawn', async () => {
    const user = userEvent.setup();
    renderView();

    await spawnSession(user);

    expect(screen.getByText('niuu/volundr')).toBeInTheDocument();
  });

  it('spawns session without chat_endpoint gracefully', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    vi.mocked(tyrService.spawnPlanSession).mockResolvedValueOnce({
      ...mockPlanSession,
      chat_endpoint: null,
    });
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    });

    expect(screen.getByTestId('session-chat')).toHaveTextContent('No URL');
  });

  it('auto-detects structure via backend extractStructure and shows commit button', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    vi.mocked(tyrService.extractStructure).mockResolvedValueOnce({
      found: true,
      structure: {
        name: 'Detected Plan',
        phases: [
          {
            name: 'P1',
            raids: [
              {
                name: 'R1',
                description: 'd',
                acceptance_criteria: ['ac1'],
                declared_files: ['f1'],
                estimate_hours: 2,
                confidence: 0.8,
              },
            ],
          },
        ],
      },
    });

    mockSkuldMessages.push({
      id: 'msg-1',
      role: 'assistant',
      content: 'Here is the plan with JSON',
      createdAt: new Date(),
      status: 'complete',
    });

    renderView();
    await spawnSession(user);

    await waitFor(() => {
      expect(tyrService.extractStructure).toHaveBeenCalledWith('Here is the plan with JSON');
    });

    await waitFor(() => {
      expect(screen.getByText(/structure detected/i)).toBeInTheDocument();
    });

    expect(screen.getByText('Detected Plan')).toBeInTheDocument();
    expect(screen.getByText('P1')).toBeInTheDocument();
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('2h')).toBeInTheDocument();
  });

  it('commits detected structure and navigates to saga', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');

    vi.mocked(tyrService.extractStructure).mockResolvedValueOnce({
      found: true,
      structure: {
        name: 'Auth Refactor',
        phases: [
          {
            name: 'Phase 1',
            raids: [
              {
                name: 'Setup middleware',
                description: 'Implement auth middleware',
                acceptance_criteria: ['Routes protected'],
                declared_files: ['src/auth.py'],
                estimate_hours: 4,
                confidence: 0.9,
              },
            ],
          },
        ],
      },
    });

    mockSkuldMessages.push({
      id: 'msg-commit',
      role: 'assistant',
      content: 'Structure output',
      createdAt: new Date(),
      status: 'complete',
    });

    renderView();
    await spawnSession(user);

    await waitFor(() => {
      expect(screen.getByText(/structure detected/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /commit saga/i }));

    await waitFor(() => {
      expect(tyrService.commitSaga).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Auth Refactor',
          repos: ['niuu/volundr'],
          phases: expect.arrayContaining([
            expect.objectContaining({
              name: 'Phase 1',
            }),
          ]),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Saga Detail')).toBeInTheDocument();
    });
  });

  it('shows error on commit failure', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');

    vi.mocked(tyrService.extractStructure).mockResolvedValueOnce({
      found: true,
      structure: {
        name: 'Plan',
        phases: [{ name: 'P1', raids: [] }],
      },
    });

    mockSkuldMessages.push({
      id: 'msg-fail',
      role: 'assistant',
      content: 'Structure output',
      createdAt: new Date(),
      status: 'complete',
    });

    vi.mocked(tyrService.commitSaga).mockRejectedValueOnce(new Error('Commit failed'));
    renderView();
    await spawnSession(user);

    await waitFor(() => {
      expect(screen.getByText(/structure detected/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /commit saga/i }));

    await waitFor(() => {
      expect(screen.getByText(/commit failed/i)).toBeInTheDocument();
    });
  });

  it('shows fallback error on commit non-Error throw', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');

    vi.mocked(tyrService.extractStructure).mockResolvedValueOnce({
      found: true,
      structure: {
        name: 'Plan',
        phases: [{ name: 'P1', raids: [] }],
      },
    });

    mockSkuldMessages.push({
      id: 'msg-fail-2',
      role: 'assistant',
      content: 'Structure output',
      createdAt: new Date(),
      status: 'complete',
    });

    vi.mocked(tyrService.commitSaga).mockRejectedValueOnce(undefined);
    renderView();
    await spawnSession(user);

    await waitFor(() => {
      expect(screen.getByText(/structure detected/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /commit saga/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to commit saga/i)).toBeInTheDocument();
    });
  });

  it('runs fallback decompose and navigates on success', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    vi.mocked(tyrService.decompose).mockResolvedValueOnce([{ name: 'Phase 1', raids: [] }]);
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /one-shot decompose/i }));

    await waitFor(() => {
      expect(tyrService.decompose).toHaveBeenCalledWith('Build auth', 'niuu/volundr');
    });

    await waitFor(() => {
      expect(screen.getByText('New Saga')).toBeInTheDocument();
    });
  });

  it('shows error on fallback decompose failure', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    vi.mocked(tyrService.decompose).mockRejectedValueOnce(new Error('LLM unavailable'));
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /one-shot decompose/i }));

    await waitFor(() => {
      expect(screen.getByText(/llm unavailable/i)).toBeInTheDocument();
    });
  });

  it('shows fallback error on decompose non-Error throw', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    vi.mocked(tyrService.decompose).mockRejectedValueOnce('oops');
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /one-shot decompose/i }));

    await waitFor(() => {
      expect(screen.getByText(/fallback decomposition failed/i)).toBeInTheDocument();
    });
  });

  it('does not navigate when decompose returns empty phases', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    vi.mocked(tyrService.decompose).mockResolvedValueOnce([]);
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /one-shot decompose/i }));

    await waitFor(() => {
      expect(tyrService.decompose).toHaveBeenCalled();
    });

    expect(screen.getByText('Plan Saga')).toBeInTheDocument();
  });

  it('does not call extractStructure for incomplete assistant messages', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    mockSkuldMessages.push({
      id: 'msg-2',
      role: 'assistant',
      content: 'Still thinking...',
      createdAt: new Date(),
      status: 'streaming',
    });
    renderView();
    await spawnSession(user);

    expect(tyrService.extractStructure).not.toHaveBeenCalled();
    expect(screen.queryByText(/structure detected/i)).not.toBeInTheDocument();
  });

  it('does not call extractStructure for user messages', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    mockSkuldMessages.push({
      id: 'msg-3',
      role: 'user',
      content: 'Some user content',
      createdAt: new Date(),
      status: 'complete',
    });
    renderView();
    await spawnSession(user);

    expect(tyrService.extractStructure).not.toHaveBeenCalled();
    expect(screen.queryByText(/structure detected/i)).not.toBeInTheDocument();
  });

  it('does not show structure when backend returns found=false', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    vi.mocked(tyrService.extractStructure).mockResolvedValueOnce({
      found: false,
      structure: null,
    });

    mockSkuldMessages.push({
      id: 'msg-6',
      role: 'assistant',
      content: 'Here is some plain text with no valid structure.',
      createdAt: new Date(),
      status: 'complete',
    });
    renderView();
    await spawnSession(user);

    await waitFor(() => {
      expect(tyrService.extractStructure).toHaveBeenCalled();
    });

    expect(screen.queryByText(/structure detected/i)).not.toBeInTheDocument();
  });

  it('handles extractStructure API failure gracefully', async () => {
    const user = userEvent.setup();
    const { tyrService } = await import('../../adapters');
    vi.mocked(tyrService.extractStructure).mockRejectedValueOnce(new Error('Network error'));

    mockSkuldMessages.push({
      id: 'msg-err',
      role: 'assistant',
      content: 'Some message',
      createdAt: new Date(),
      status: 'complete',
    });
    renderView();
    await spawnSession(user);

    await waitFor(() => {
      expect(tyrService.extractStructure).toHaveBeenCalled();
    });

    // No crash, no structure shown
    expect(screen.queryByText(/structure detected/i)).not.toBeInTheDocument();
  });
});
