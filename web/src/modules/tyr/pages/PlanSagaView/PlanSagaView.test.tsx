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
      Promise.resolve({ ...mockSessionWithStructure, status: 'COMPLETED' }),
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
    </MemoryRouter>,
  );
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

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(planningService.spawnSession).toHaveBeenCalledWith('Build auth', 'niuu/volundr');
    });

    // After spawning, should show the session area
    await waitFor(() => {
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    });
  });

  it('shows error on spawn failure', async () => {
    const user = userEvent.setup();
    const { planningService } = await import('../../adapters');
    vi.mocked(planningService.spawnSession).mockRejectedValueOnce(
      new Error('Volundr unreachable'),
    );
    renderView();

    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(screen.getByText(/volundr unreachable/i)).toBeInTheDocument();
    });
  });

  it('shows structure preview after proposing', async () => {
    const user = userEvent.setup();
    renderView();

    // Spawn session
    await user.type(screen.getByLabelText(/specification/i), 'Build auth');
    await user.type(screen.getByLabelText(/repository/i), 'niuu/volundr');
    await user.click(screen.getByRole('button', { name: /start planning session/i }));

    await waitFor(() => {
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    });

    // Propose structure — use fireEvent to avoid userEvent parsing curly braces
    const jsonInput = screen.getByPlaceholderText(/name.*phases/i);
    fireEvent.change(jsonInput, { target: { value: '{"name":"test"}' } });
    await user.click(screen.getByRole('button', { name: /propose structure/i }));

    await waitFor(() => {
      expect(screen.getByText('Auth Refactor')).toBeInTheDocument();
      expect(screen.getByText('Phase 1')).toBeInTheDocument();
      expect(screen.getByText('Setup middleware')).toBeInTheDocument();
    });
  });
});
