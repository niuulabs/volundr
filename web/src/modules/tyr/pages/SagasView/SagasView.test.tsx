import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SagasView } from './SagasView';
import * as hooks from '../../hooks';

vi.mock('../../hooks', () => ({
  useSagas: vi.fn(),
}));

vi.mock('@/modules/shared', () => ({
  LoadingIndicator: ({ messages }: { messages?: string[] }) => (
    <div data-testid="loading-indicator">{messages?.[0]}</div>
  ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockSaga = {
  id: 'saga-1',
  tracker_id: 'proj-1',
  tracker_type: 'linear',
  slug: 'my-saga',
  name: 'Implement auth flow',
  repos: ['niuulabs/app'],
  feature_branch: 'feat/my-saga',
  status: 'started',
  progress: 0.5,
  milestone_count: 3,
  issue_count: 10,
  url: 'https://linear.app/proj-1',
};

describe('SagasView', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    vi.mocked(hooks.useSagas).mockReturnValue({
      sagas: [mockSaga],
      loading: false,
      error: null,
      refresh: vi.fn(),
      deleteSaga: vi.fn(),
    });
  });

  it('renders saga data', () => {
    render(
      <MemoryRouter>
        <SagasView />
      </MemoryRouter>
    );
    expect(screen.getByText('Implement auth flow')).toBeInTheDocument();
    expect(screen.getByText('niuulabs/app')).toBeInTheDocument();
    expect(screen.getByText('3 milestones')).toBeInTheDocument();
    expect(screen.getByText('10 issues')).toBeInTheDocument();
  });

  it('shows progress', () => {
    render(
      <MemoryRouter>
        <SagasView />
      </MemoryRouter>
    );
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('renders loading indicator when loading', () => {
    vi.mocked(hooks.useSagas).mockReturnValue({
      sagas: [],
      loading: true,
      error: null,
      refresh: vi.fn(),
      deleteSaga: vi.fn(),
    });
    render(
      <MemoryRouter>
        <SagasView />
      </MemoryRouter>
    );
    expect(screen.getByText('Loading sagas...')).toBeInTheDocument();
  });

  it('renders error message', () => {
    vi.mocked(hooks.useSagas).mockReturnValue({
      sagas: [],
      loading: false,
      error: 'Network error',
      refresh: vi.fn(),
      deleteSaga: vi.fn(),
    });
    render(
      <MemoryRouter>
        <SagasView />
      </MemoryRouter>
    );
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    vi.mocked(hooks.useSagas).mockReturnValue({
      sagas: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      deleteSaga: vi.fn(),
    });
    render(
      <MemoryRouter>
        <SagasView />
      </MemoryRouter>
    );
    expect(screen.getByText('No sagas imported yet')).toBeInTheDocument();
  });

  it('navigates to saga detail on card click', () => {
    render(
      <MemoryRouter>
        <SagasView />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Implement auth flow'));
    expect(mockNavigate).toHaveBeenCalledWith('/tyr/sagas/saga-1');
  });

  it('navigates to import on button click', () => {
    render(
      <MemoryRouter>
        <SagasView />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText('Import from Tracker'));
    expect(mockNavigate).toHaveBeenCalledWith('/tyr/import');
  });
});
