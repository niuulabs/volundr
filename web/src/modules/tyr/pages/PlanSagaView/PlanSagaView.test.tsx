import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { PlanSagaView } from './PlanSagaView';
import type { PlanningSession, PlanningMessage } from '../../models/planning';

const mockSession: PlanningSession = {
  id: 'plan-001',
  owner_id: 'user-1',
  session_id: 'volundr-sess-001',
  repo: 'niuu/volundr',
  status: 'ACTIVE',
  structure: null,
  created_at: '2026-03-25T10:00:00Z',
  updated_at: '2026-03-25T10:00:00Z',
};

const mockMessage: PlanningMessage = {
  id: 'msg-001',
  content: 'Split the auth phase',
  sender: 'user',
  created_at: '2026-03-25T10:00:00Z',
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
    sendMessage: vi.fn(() => Promise.resolve({ ...mockMessage })),
    proposeStructure: vi.fn(() => Promise.resolve({ ...mockSessionWithStructure })),
    completeSession: vi.fn(() =>
      Promise.resolve({ ...mockSessionWithStructure, status: 'COMPLETED' })
    ),
    deleteSession: vi.fn(() => Promise.resolve()),
  },
  tyrService: {
    decompose: vi.fn(() => Promise.resolve([])),
    createSaga: vi.fn(() => Promise.resolve({ id: 'saga-001' })),
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

  it('sends a message in the chat panel', async () => {
    const user = userEvent.setup();
    const { planningService } = await import('../../adapters');
    renderView();

    await spawnSession(user);

    const chatInput = screen.getByPlaceholderText(/discuss/i);
    await user.type(chatInput, 'Should we add caching?');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(planningService.sendMessage).toHaveBeenCalledWith(
        'plan-001',
        'Should we add caching?'
      );
    });
  });

  it('shows error on send message failure', async () => {
    const user = userEvent.setup();
    const { planningService } = await import('../../adapters');
    vi.mocked(planningService.sendMessage).mockRejectedValueOnce(new Error('Send failed'));
    renderView();

    await spawnSession(user);

    const chatInput = screen.getByPlaceholderText(/discuss/i);
    await user.type(chatInput, 'Test msg');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/send failed/i)).toBeInTheDocument();
    });
  });

  it('shows fallback error on send message non-Error throw', async () => {
    const user = userEvent.setup();
    const { planningService } = await import('../../adapters');
    vi.mocked(planningService.sendMessage).mockRejectedValueOnce(42);
    renderView();

    await spawnSession(user);

    const chatInput = screen.getByPlaceholderText(/discuss/i);
    await user.type(chatInput, 'Test msg');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to send message/i)).toBeInTheDocument();
    });
  });

  it('shows structure preview after proposing', async () => {
    const user = userEvent.setup();
    renderView();

    await spawnSession(user);

    const jsonInput = screen.getByPlaceholderText(/name.*phases/i);
    fireEvent.change(jsonInput, { target: { value: '{"name":"test"}' } });
    await user.click(screen.getByRole('button', { name: /propose structure/i }));

    await waitFor(() => {
      expect(screen.getByText('Auth Refactor')).toBeInTheDocument();
      expect(screen.getByText('Phase 1')).toBeInTheDocument();
      expect(screen.getByText('Setup middleware')).toBeInTheDocument();
    });
  });

  it('shows error on propose structure failure', async () => {
    const user = userEvent.setup();
    const { planningService } = await import('../../adapters');
    vi.mocked(planningService.proposeStructure).mockRejectedValueOnce(
      new Error('Invalid JSON schema')
    );
    renderView();

    await spawnSession(user);

    const jsonInput = screen.getByPlaceholderText(/name.*phases/i);
    fireEvent.change(jsonInput, { target: { value: '{"bad": true}' } });
    await user.click(screen.getByRole('button', { name: /propose structure/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid json schema/i)).toBeInTheDocument();
    });
  });

  it('shows fallback error on propose structure non-Error throw', async () => {
    const user = userEvent.setup();
    const { planningService } = await import('../../adapters');
    vi.mocked(planningService.proposeStructure).mockRejectedValueOnce(null);
    renderView();

    await spawnSession(user);

    const jsonInput = screen.getByPlaceholderText(/name.*phases/i);
    fireEvent.change(jsonInput, { target: { value: '{"x":1}' } });
    await user.click(screen.getByRole('button', { name: /propose structure/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid saga structure/i)).toBeInTheDocument();
    });
  });

  it('commits saga and navigates on success', async () => {
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
      expect(screen.getByText('STRUCTURE_PROPOSED')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /commit saga/i }));

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
});
