import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { PlanWizard } from './PlanWizard';
import { PlanPrompt } from './PlanPrompt';
import { PlanQuestions } from './PlanQuestions';
import { PlanRaiding } from './PlanRaiding';
import { PlanDraft } from './PlanDraft';
import { PlanApproved } from './PlanApproved';
import type { ITyrService, ExtractedStructure, PlanSession } from '../ports';
import type { Saga } from '../domain/saga';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_SESSION: PlanSession = {
  sessionId: 'plan-test-1',
  chatEndpoint: null,
  questions: [
    { id: 'q1', question: 'Which repos?', hint: 'e.g. niuulabs/volundr' },
    { id: 'q2', question: 'Base branch?' },
  ],
};

const MOCK_STRUCTURE: ExtractedStructure = {
  found: true,
  structure: {
    name: 'Auth Rewrite',
    phases: [
      {
        name: 'Phase 1: Foundation',
        raids: [
          {
            name: 'Scaffold OIDC',
            description: 'Add OIDC login',
            acceptanceCriteria: ['SSO works'],
            declaredFiles: ['src/auth.ts'],
            estimateHours: 8,
            confidence: 85,
          },
        ],
      },
      {
        name: 'Phase 2: Hardening',
        raids: [
          {
            name: 'Add PAT support',
            description: 'Headless PATs',
            acceptanceCriteria: ['PATs revocable'],
            declaredFiles: ['src/pat.ts'],
            estimateHours: 4,
            confidence: 70,
          },
        ],
      },
    ],
  },
};

const MOCK_SAGA: Saga = {
  id: 'saga-test-1',
  trackerId: 'NIU-999',
  trackerType: 'linear',
  slug: 'auth-rewrite',
  name: 'Auth Rewrite',
  repos: ['niuulabs/volundr'],
  featureBranch: 'feat/auth-rewrite',
  status: 'active',
  confidence: 77,
  createdAt: '2026-01-01T00:00:00Z',
  phaseSummary: { total: 2, completed: 0 },
};

function makeSvc(overrides: Partial<ITyrService> = {}): Partial<ITyrService> {
  return {
    getSagas: vi.fn().mockResolvedValue([]),
    getSaga: vi.fn().mockResolvedValue(null),
    getPhases: vi.fn().mockResolvedValue([]),
    createSaga: vi.fn(),
    commitSaga: vi.fn().mockResolvedValue(MOCK_SAGA),
    decompose: vi.fn().mockResolvedValue([]),
    spawnPlanSession: vi.fn().mockResolvedValue(MOCK_SESSION),
    extractStructure: vi.fn().mockResolvedValue(MOCK_STRUCTURE),
    ...overrides,
  };
}

function wrap(svc: Partial<ITyrService>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ServicesProvider services={{ tyr: svc }}>{children}</ServicesProvider>
      </QueryClientProvider>
    );
  };
}

// ---------------------------------------------------------------------------
// PlanPrompt unit tests
// ---------------------------------------------------------------------------

describe('PlanPrompt', () => {
  it('renders the heading', () => {
    render(<PlanPrompt onSubmit={vi.fn()} loading={false} error={null} />);
    expect(screen.getByText('Describe your goal')).toBeInTheDocument();
  });

  it('calls onSubmit with trimmed values', async () => {
    const onSubmit = vi.fn();
    render(<PlanPrompt onSubmit={onSubmit} loading={false} error={null} />);

    await userEvent.type(screen.getByRole('textbox', { name: /goal description/i }), '  Build auth  ');
    await userEvent.type(screen.getByRole('textbox', { name: /target repository/i }), 'niuulabs/volundr');
    fireEvent.submit(screen.getByRole('form', { name: /plan prompt form/i }));

    expect(onSubmit).toHaveBeenCalledWith('Build auth', 'niuulabs/volundr');
  });

  it('does not submit when prompt is empty', () => {
    const onSubmit = vi.fn();
    render(<PlanPrompt onSubmit={onSubmit} loading={false} error={null} />);
    fireEvent.submit(screen.getByRole('form', { name: /plan prompt form/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables submit button while loading', () => {
    render(<PlanPrompt onSubmit={vi.fn()} loading={true} error={null} />);
    expect(screen.getByRole('button', { name: /starting/i })).toBeDisabled();
  });

  it('renders error message', () => {
    render(<PlanPrompt onSubmit={vi.fn()} loading={false} error="Service unavailable" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable');
  });
});

// ---------------------------------------------------------------------------
// PlanQuestions unit tests
// ---------------------------------------------------------------------------

describe('PlanQuestions', () => {
  const questions = [
    { id: 'q1', question: 'Which repos?', hint: 'e.g. niuulabs/volundr' },
    { id: 'q2', question: 'Base branch?' },
  ];

  it('renders all questions', () => {
    render(<PlanQuestions questions={questions} onSubmit={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('Which repos?')).toBeInTheDocument();
    expect(screen.getByText('Base branch?')).toBeInTheDocument();
  });

  it('renders hints', () => {
    render(<PlanQuestions questions={questions} onSubmit={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText('e.g. niuulabs/volundr')).toBeInTheDocument();
  });

  it('calls onSubmit with answers', async () => {
    const onSubmit = vi.fn();
    render(<PlanQuestions questions={questions} onSubmit={onSubmit} onBack={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/1\./), 'niuulabs/volundr');
    fireEvent.submit(screen.getByRole('form'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ q1: 'niuulabs/volundr' }),
    );
  });

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn();
    render(<PlanQuestions questions={questions} onSubmit={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows empty-state message when no questions', () => {
    render(<PlanQuestions questions={[]} onSubmit={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(/no clarifying questions/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PlanRaiding unit tests
// ---------------------------------------------------------------------------

describe('PlanRaiding', () => {
  it('shows processing indicator', () => {
    render(<PlanRaiding error={null} onBack={vi.fn()} />);
    // Use aria-label to disambiguate from StateDot's inner role="status"
    expect(screen.getByLabelText(/decomposing plan/i)).toBeInTheDocument();
    expect(screen.getByText(/Ravens are raiding/i)).toBeInTheDocument();
  });

  it('shows error state when error is present', () => {
    render(<PlanRaiding error="Decompose failed" onBack={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Decompose failed')).toBeInTheDocument();
  });

  it('calls onBack on error try-again click', () => {
    const onBack = vi.fn();
    render(<PlanRaiding error="oops" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('has aria-label for the raiding container', () => {
    render(<PlanRaiding error={null} onBack={vi.fn()} />);
    expect(screen.getByLabelText(/decomposing plan/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PlanDraft unit tests
// ---------------------------------------------------------------------------

describe('PlanDraft', () => {
  it('renders saga name', () => {
    render(
      <PlanDraft
        structure={MOCK_STRUCTURE}
        loading={false}
        error={null}
        onApprove={vi.fn()}
        onBack={vi.fn()}
        onEditPhase={vi.fn()}
      />,
    );
    expect(screen.getByText('Auth Rewrite')).toBeInTheDocument();
  });

  it('renders all phase names', () => {
    render(
      <PlanDraft
        structure={MOCK_STRUCTURE}
        loading={false}
        error={null}
        onApprove={vi.fn()}
        onBack={vi.fn()}
        onEditPhase={vi.fn()}
      />,
    );
    expect(screen.getByText('Phase 1: Foundation')).toBeInTheDocument();
    expect(screen.getByText('Phase 2: Hardening')).toBeInTheDocument();
  });

  it('renders raid names', () => {
    render(
      <PlanDraft
        structure={MOCK_STRUCTURE}
        loading={false}
        error={null}
        onApprove={vi.fn()}
        onBack={vi.fn()}
        onEditPhase={vi.fn()}
      />,
    );
    expect(screen.getByText('Scaffold OIDC')).toBeInTheDocument();
  });

  it('calls onApprove when approve button clicked', async () => {
    const onApprove = vi.fn();
    render(
      <PlanDraft
        structure={MOCK_STRUCTURE}
        loading={false}
        error={null}
        onApprove={onApprove}
        onBack={vi.fn()}
        onEditPhase={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalled();
  });

  it('calls onBack when back button clicked', () => {
    const onBack = vi.fn();
    render(
      <PlanDraft
        structure={MOCK_STRUCTURE}
        loading={false}
        error={null}
        onApprove={vi.fn()}
        onBack={onBack}
        onEditPhase={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('allows editing a phase name', async () => {
    const onEditPhase = vi.fn();
    render(
      <PlanDraft
        structure={MOCK_STRUCTURE}
        loading={false}
        error={null}
        onApprove={vi.fn()}
        onBack={vi.fn()}
        onEditPhase={onEditPhase}
      />,
    );

    // Click edit on the first phase
    const editButtons = screen.getAllByRole('button', { name: /edit phase/i });
    fireEvent.click(editButtons[0]!);

    const input = screen.getByLabelText(/edit phase 1 name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Renamed Phase');
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onEditPhase).toHaveBeenCalledWith(0, 'Renamed Phase');
  });

  it('shows empty state when no phases', () => {
    const emptyStructure: ExtractedStructure = {
      found: false,
      structure: { name: 'Saga', phases: [] },
    };
    render(
      <PlanDraft
        structure={emptyStructure}
        loading={false}
        error={null}
        onApprove={vi.fn()}
        onBack={vi.fn()}
        onEditPhase={vi.fn()}
      />,
    );
    expect(screen.getByText(/no phases extracted/i)).toBeInTheDocument();
  });

  it('disables approve when loading', () => {
    render(
      <PlanDraft
        structure={MOCK_STRUCTURE}
        loading={true}
        error={null}
        onApprove={vi.fn()}
        onBack={vi.fn()}
        onEditPhase={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /launching/i })).toBeDisabled();
  });

  it('shows error message', () => {
    render(
      <PlanDraft
        structure={MOCK_STRUCTURE}
        loading={false}
        error="Commit failed"
        onApprove={vi.fn()}
        onBack={vi.fn()}
        onEditPhase={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Commit failed');
  });

  it('cancels editing without calling onEditPhase', () => {
    const onEditPhase = vi.fn();
    render(
      <PlanDraft
        structure={MOCK_STRUCTURE}
        loading={false}
        error={null}
        onApprove={vi.fn()}
        onBack={vi.fn()}
        onEditPhase={onEditPhase}
      />,
    );
    const editButtons = screen.getAllByRole('button', { name: /edit phase/i });
    fireEvent.click(editButtons[0]!);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onEditPhase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PlanApproved unit tests
// ---------------------------------------------------------------------------

describe('PlanApproved', () => {
  it('renders the saga name', () => {
    render(<PlanApproved saga={MOCK_SAGA} />);
    // saga name appears in both the description span and the summary dl
    expect(screen.getAllByText('Auth Rewrite').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the "Open in Sagas" link', () => {
    render(<PlanApproved saga={MOCK_SAGA} />);
    expect(screen.getByRole('link', { name: /open in sagas/i })).toBeInTheDocument();
  });

  it('shows feature branch', () => {
    render(<PlanApproved saga={MOCK_SAGA} />);
    expect(screen.getByText('feat/auth-rewrite')).toBeInTheDocument();
  });

  it('calls onNewPlan when new plan button clicked', () => {
    const onNewPlan = vi.fn();
    render(<PlanApproved saga={MOCK_SAGA} onNewPlan={onNewPlan} />);
    fireEvent.click(screen.getByRole('button', { name: /new plan/i }));
    expect(onNewPlan).toHaveBeenCalled();
  });

  it('does not render new plan button when onNewPlan not provided', () => {
    render(<PlanApproved saga={MOCK_SAGA} />);
    expect(screen.queryByRole('button', { name: /new plan/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PlanWizard integration tests
// ---------------------------------------------------------------------------

describe('PlanWizard integration', () => {
  it('renders the prompt step initially', () => {
    render(<PlanWizard />, { wrapper: wrap(makeSvc()) });
    expect(screen.getByText('Describe your goal')).toBeInTheDocument();
  });

  it('shows the step dots navigation', () => {
    render(<PlanWizard />, { wrapper: wrap(makeSvc()) });
    expect(screen.getByRole('navigation', { name: /plan wizard steps/i })).toBeInTheDocument();
  });

  it('shows the Tyr rune in the header', () => {
    render(<PlanWizard />, { wrapper: wrap(makeSvc()) });
    expect(screen.getByText('ᛏ')).toBeInTheDocument();
  });

  it('advances to questions step after submitting prompt', async () => {
    const svc = makeSvc();
    render(<PlanWizard />, { wrapper: wrap(svc) });

    await userEvent.type(
      screen.getByRole('textbox', { name: /goal description/i }),
      'Build auth module',
    );
    fireEvent.submit(screen.getByRole('form', { name: /plan prompt form/i }));

    await waitFor(() => expect(screen.getByText('Clarify your plan')).toBeInTheDocument());
    expect(screen.getByText('Which repos?')).toBeInTheDocument();
  });

  it('advances to raiding step after submitting answers', async () => {
    const svc = makeSvc();
    render(<PlanWizard />, { wrapper: wrap(svc) });

    // Step 1: prompt
    await userEvent.type(
      screen.getByRole('textbox', { name: /goal description/i }),
      'Build auth module',
    );
    fireEvent.submit(screen.getByRole('form', { name: /plan prompt form/i }));
    await waitFor(() => expect(screen.getByText('Clarify your plan')).toBeInTheDocument());

    // Step 2: questions
    fireEvent.submit(screen.getByRole('form', { name: /clarifying questions form/i }));

    await waitFor(() => expect(screen.getByLabelText(/decomposing plan/i)).toBeInTheDocument());
  });

  it('auto-advances to draft after decomposition', async () => {
    const svc = makeSvc();
    render(<PlanWizard />, { wrapper: wrap(svc) });

    // Through to raiding
    await userEvent.type(
      screen.getByRole('textbox', { name: /goal description/i }),
      'Build auth module',
    );
    fireEvent.submit(screen.getByRole('form', { name: /plan prompt form/i }));
    await waitFor(() => expect(screen.getByText('Clarify your plan')).toBeInTheDocument());
    fireEvent.submit(screen.getByRole('form', { name: /clarifying questions form/i }));

    // Should auto-advance to draft
    await waitFor(() => expect(screen.getByText('Review your plan')).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText('Auth Rewrite')).toBeInTheDocument();
  });

  it('reaches approved step after full flow', async () => {
    const svc = makeSvc();
    render(<PlanWizard />, { wrapper: wrap(svc) });

    // Prompt
    await userEvent.type(
      screen.getByRole('textbox', { name: /goal description/i }),
      'Build auth',
    );
    fireEvent.submit(screen.getByRole('form', { name: /plan prompt form/i }));
    await waitFor(() => expect(screen.getByText('Clarify your plan')).toBeInTheDocument());

    // Questions
    fireEvent.submit(screen.getByRole('form', { name: /clarifying questions form/i }));
    await waitFor(() => expect(screen.getByText('Review your plan')).toBeInTheDocument(), {
      timeout: 3000,
    });

    // Draft → approve
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    });

    await waitFor(() => expect(screen.getByTestId('plan-approved')).toBeInTheDocument());
    expect(screen.getByText('Saga launched!')).toBeInTheDocument();
  });

  it('can navigate back from questions to prompt', async () => {
    const svc = makeSvc();
    render(<PlanWizard />, { wrapper: wrap(svc) });

    await userEvent.type(
      screen.getByRole('textbox', { name: /goal description/i }),
      'Build auth',
    );
    fireEvent.submit(screen.getByRole('form', { name: /plan prompt form/i }));
    await waitFor(() => expect(screen.getByText('Clarify your plan')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('Describe your goal')).toBeInTheDocument();
  });

  it('shows error when spawnPlanSession fails', async () => {
    const svc = makeSvc({
      spawnPlanSession: vi.fn().mockRejectedValue(new Error('Tyr unavailable')),
    });
    render(<PlanWizard />, { wrapper: wrap(svc) });

    await userEvent.type(
      screen.getByRole('textbox', { name: /goal description/i }),
      'Build auth',
    );
    fireEvent.submit(screen.getByRole('form', { name: /plan prompt form/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('Tyr unavailable')).toBeInTheDocument();
  });
});
