import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DetailView } from './DetailView';
import * as hooks from '../../hooks';

vi.mock('../../hooks', () => ({
  useSagaDetail: vi.fn(),
}));

vi.mock('@/modules/shared', () => ({
  LoadingIndicator: ({ messages, label }: { messages?: string[]; label?: string }) => (
    <div data-testid="loading-indicator">{messages?.[0] ?? label}</div>
  ),
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
}));

function renderDetailView() {
  return render(
    <MemoryRouter initialEntries={['/tyr/sagas/saga-1']}>
      <Routes>
        <Route path="/tyr/sagas/:id" element={<DetailView />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('DetailView', () => {
  beforeEach(() => {
    vi.mocked(hooks.useSagaDetail).mockReturnValue({
      saga: {
        id: 'saga-1',
        tracker_id: 'PROJ-100',
        tracker_type: 'linear',
        slug: 'auth-flow',
        name: 'Implement auth flow',
        repo: 'niuulabs/app',
        feature_branch: 'feat/auth',
        status: 'active',
        confidence: 0.72,
        created_at: '2026-01-01T00:00:00Z',
      },
      phases: [
        {
          id: 'phase-1',
          saga_id: 'saga-1',
          tracker_id: 'PROJ-101',
          number: 1,
          name: 'Foundation',
          status: 'active',
          confidence: 0.8,
          raids: [],
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useSagaDetail>);
  });

  it('renders saga name', () => {
    renderDetailView();
    expect(screen.getByText('Implement auth flow')).toBeInTheDocument();
  });

  it('renders phase blocks', () => {
    renderDetailView();
    expect(screen.getByText('Foundation')).toBeInTheDocument();
  });

  it('renders branch tag', () => {
    renderDetailView();
    expect(screen.getByText('feat/auth')).toBeInTheDocument();
  });

  it('renders loading indicator when loading', () => {
    vi.mocked(hooks.useSagaDetail).mockReturnValue({
      saga: null,
      phases: [],
      loading: true,
      error: null,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof hooks.useSagaDetail>);

    renderDetailView();
    expect(screen.getByText('Loading saga...')).toBeInTheDocument();
  });

  it('renders error message when error occurs', () => {
    vi.mocked(hooks.useSagaDetail).mockReturnValue({
      saga: null,
      phases: [],
      loading: false,
      error: 'Failed to load saga',
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof hooks.useSagaDetail>);

    renderDetailView();
    expect(screen.getByText('Failed to load saga')).toBeInTheDocument();
  });

  it('renders empty state when saga is null', () => {
    vi.mocked(hooks.useSagaDetail).mockReturnValue({
      saga: null,
      phases: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof hooks.useSagaDetail>);

    renderDetailView();
    expect(screen.getByText('Saga not found')).toBeInTheDocument();
  });

  it('renders empty phases message when phases array is empty', () => {
    vi.mocked(hooks.useSagaDetail).mockReturnValue({
      saga: {
        id: 'saga-1',
        tracker_id: 'PROJ-100',
        tracker_type: 'linear',
        slug: 'auth-flow',
        name: 'Implement auth flow',
        repo: 'niuulabs/app',
        feature_branch: 'feat/auth',
        status: 'active',
        confidence: 0.72,
        created_at: '2026-01-01T00:00:00Z',
      },
      phases: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useSagaDetail>);

    renderDetailView();
    expect(screen.getByText('No phases defined')).toBeInTheDocument();
  });

  it('renders repo and tracker id', () => {
    renderDetailView();
    expect(screen.getByText('niuulabs/app')).toBeInTheDocument();
    expect(screen.getByText('PROJ-100')).toBeInTheDocument();
  });
});
