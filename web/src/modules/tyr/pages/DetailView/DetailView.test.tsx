import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DetailView } from './DetailView';
import * as hooks from '../../hooks';

vi.mock('../../hooks', () => ({
  useSagaDetail: vi.fn(),
}));

vi.mock('@/modules/shared', () => ({
  LoadingIndicator: ({ messages }: { messages?: string[] }) => (
    <div data-testid="loading-indicator">{messages?.[0]}</div>
  ),
}));

const mockDetail = {
  id: 'saga-1',
  tracker_id: 'proj-1',
  tracker_type: 'linear',
  slug: 'auth-flow',
  name: 'Implement auth flow',
  description: 'Auth flow project',
  repos: ['niuulabs/app'],
  feature_branch: 'feat/auth',
  status: 'started',
  progress: 0.5,
  url: 'https://linear.app/proj-1',
  phases: [
    {
      id: 'ms-1',
      name: 'Foundation',
      description: '',
      sort_order: 1,
      progress: 1.0,
      target_date: null,
      raids: [
        {
          id: 'i-1',
          identifier: 'A-1',
          title: 'Setup task',
          status: 'Done',
          status_type: 'completed',
          assignee: null,
          labels: [],
          priority: 1,
          priority_label: 'Urgent',
          estimate: 2,
          url: '',
        },
      ],
    },
  ],
};

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
      detail: mockDetail,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
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

  it('renders raid data', () => {
    renderDetailView();
    expect(screen.getByText('A-1')).toBeInTheDocument();
    expect(screen.getByText('Setup task')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('renders loading indicator when loading', () => {
    vi.mocked(hooks.useSagaDetail).mockReturnValue({
      detail: null,
      loading: true,
      error: null,
      refresh: vi.fn(),
    });
    renderDetailView();
    expect(screen.getByText('Loading saga...')).toBeInTheDocument();
  });

  it('renders error message', () => {
    vi.mocked(hooks.useSagaDetail).mockReturnValue({
      detail: null,
      loading: false,
      error: 'Failed to load',
      refresh: vi.fn(),
    });
    renderDetailView();
    expect(screen.getByText('Failed to load')).toBeInTheDocument();
  });

  it('renders empty state when detail is null', () => {
    vi.mocked(hooks.useSagaDetail).mockReturnValue({
      detail: null,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    renderDetailView();
    expect(screen.getByText('Saga not found')).toBeInTheDocument();
  });

  it('renders empty phases message', () => {
    vi.mocked(hooks.useSagaDetail).mockReturnValue({
      detail: { ...mockDetail, phases: [] },
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    renderDetailView();
    expect(screen.getByText('No phases')).toBeInTheDocument();
  });

  it('renders repo', () => {
    renderDetailView();
    expect(screen.getByText('niuulabs/app')).toBeInTheDocument();
  });

  it('renders progress percentage', () => {
    renderDetailView();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('renders Linear link', () => {
    renderDetailView();
    expect(screen.getByText('Linear')).toBeInTheDocument();
  });

  it('renders different raid status colors', () => {
    const detailWithStatuses = {
      ...mockDetail,
      phases: [
        {
          ...mockDetail.phases[0],
          raids: [
            { ...mockDetail.phases[0].raids[0], status: 'Done', status_type: 'completed' },
            {
              id: 'i-2',
              identifier: 'A-2',
              title: 'Started task',
              status: 'In Progress',
              status_type: 'started',
              assignee: 'Dev',
              labels: [],
              priority: 2,
              priority_label: 'High',
              estimate: null,
              url: '',
            },
            {
              id: 'i-3',
              identifier: 'A-3',
              title: 'Cancelled task',
              status: 'Cancelled',
              status_type: 'cancelled',
              assignee: null,
              labels: [],
              priority: 4,
              priority_label: '',
              estimate: null,
              url: '',
            },
            {
              id: 'i-4',
              identifier: 'A-4',
              title: 'Backlog task',
              status: 'Backlog',
              status_type: 'backlog',
              assignee: null,
              labels: [],
              priority: 0,
              priority_label: '',
              estimate: null,
              url: '',
            },
          ],
        },
      ],
    };
    vi.mocked(hooks.useSagaDetail).mockReturnValue({
      detail: detailWithStatuses,
      loading: false,
      error: null,
      refresh: vi.fn(),
    });
    renderDetailView();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Backlog')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Dev')).toBeInTheDocument();
  });
});
