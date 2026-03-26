import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlanSagaView } from './PlanSagaView';
import type { PlanningSession } from '../../models/planning';

const mockSendMessage = vi.fn();
const mockSkuldMessages: Array<{
  id: string;
  role: string;
  content: string;
  createdAt: Date;
  status: string;
}> = [];

vi.mock('@/modules/volundr/hooks/useSkuldChat', () => ({
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

const mockSession: PlanningSession = {
  id: 'plan-001',
  owner_id: 'user-1',
  session_id: 'volundr-sess-001',
  repo: 'niuu/volundr',
  status: 'ACTIVE',
  structure: null,
  chat_endpoint: 'wss://sessions.test/s/volundr-sess-001/session',
  created_at: '2026-03-25T10:00:00Z',
  updated_at: '2026-03-25T10:00:00Z',
};

const mockSessionWithStructure: PlanningSession = {
  ...mockSession,
  status: 'STRUCTURE_PROPOSED',
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
            confidence: 0.8,
          },
        ],
      },
    ],
  },
};

vi.mock('../../adapters', () => ({
  planningService: {
    spawnSession: vi.fn(() => Promise.resolve({ ...mockSession })),
    sendMessage: vi.fn(),
    proposeStructure: vi.fn(() => Promise.resolve({ ...mockSessionWithStructure })),
    completeSession: vi.fn(() =>
      Promise.resolve({ ...mockSessionWithStructure, status: 'COMPLETED' })
    ),
    deleteSession: vi.fn(() => Promise.resolve()),
  },
  tyrService: {
    decompose: vi.fn(() => Promise.resolve([])),
    createSaga: vi.fn(() => Promise.resolve({ id: 'saga-001' })),
    commitSaga: vi.fn(() => Promise.resolve({ id: 'saga-001' })),
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

  it('spawns a planning session on button click', async () => {
    const user = userEvent.setup();
    const { planningService } = await import('../../adapters');
    renderView();

    await spawnSession(user);

    expect(planningService.spawnSession).toHaveBeenCalledWith('Build auth', 'niuu/volundr');
  });

  it('shows error on spawn failure', async () => {
    const user = userEvent.setup();
    const { planningService } = await import('../../adapters');
    vi.mocked(planningService.spawnSession).mockRejectedValueOnce(new Error('Volundr unreachable'));
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
    const { planningService } = await import('../../adapters');
    vi.mocked(planningService.spawnSession).mockRejectedValueOnce('string error');
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to spawn planning session/i)).toBeInTheDocument();
    });
  });

  it('sends a message via skuld WebSocket', async () => {
    const user = userEvent.setup();
    renderView();

    await spawnSession(user);

    const chatInput = screen.getByPlaceholderText(/discuss/i);
    await user.type(chatInput, 'Should we add caching?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(mockSendMessage).toHaveBeenCalledWith('Should we add caching?');
  });

  it('commits saga with structure and navigates', async () => {
    const user = userEvent.setup();
    const { planningService, tyrService } = await import('../../adapters');
    vi.mocked(planningService.spawnSession).mockResolvedValueOnce({
      ...mockSessionWithStructure,
    });
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(screen.getByText('STRUCTURE_PROPOSED')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /commit saga/i }));

    await waitFor(() => {
      expect(planningService.completeSession).toHaveBeenCalledWith('plan-001');
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
    const { planningService } = await import('../../adapters');
    vi.mocked(planningService.spawnSession).mockResolvedValueOnce({
      ...mockSessionWithStructure,
    });
    vi.mocked(planningService.completeSession).mockRejectedValueOnce(new Error('Commit failed'));
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(screen.getByText('STRUCTURE_PROPOSED')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /commit saga/i }));

    await waitFor(() => {
      expect(screen.getByText(/commit failed/i)).toBeInTheDocument();
    });
  });

  it('shows fallback error on commit non-Error throw', async () => {
    const user = userEvent.setup();
    const { planningService } = await import('../../adapters');
    vi.mocked(planningService.spawnSession).mockResolvedValueOnce({
      ...mockSessionWithStructure,
    });
    vi.mocked(planningService.completeSession).mockRejectedValueOnce(undefined);
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(screen.getByText('STRUCTURE_PROPOSED')).toBeInTheDocument();
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

    // Should still be on the plan page
    expect(screen.getByText('Plan Saga')).toBeInTheDocument();
  });

  it('shows session status and repo after spawn', async () => {
    const user = userEvent.setup();
    renderView();

    await spawnSession(user);

    expect(screen.getByText('niuu/volundr')).toBeInTheDocument();
  });

  it('shows structure preview with phase and raid details', async () => {
    const user = userEvent.setup();
    const { planningService } = await import('../../adapters');
    vi.mocked(planningService.spawnSession).mockResolvedValueOnce({
      ...mockSessionWithStructure,
    });
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(screen.getByText('Auth Refactor')).toBeInTheDocument();
      expect(screen.getByText('Phase 1')).toBeInTheDocument();
      expect(screen.getByText('Setup middleware')).toBeInTheDocument();
      expect(screen.getByText('4h')).toBeInTheDocument();
    });
  });
});
