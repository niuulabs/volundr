import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DetailView } from './DetailView';

vi.mock('../../hooks', () => ({
  useSagaDetail: () => ({
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
  }),
}));

describe('DetailView', () => {
  it('renders saga name', () => {
    render(
      <MemoryRouter initialEntries={['/tyr/sagas/saga-1']}>
        <Routes>
          <Route path="/tyr/sagas/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Implement auth flow')).toBeInTheDocument();
  });

  it('renders phase blocks', () => {
    render(
      <MemoryRouter initialEntries={['/tyr/sagas/saga-1']}>
        <Routes>
          <Route path="/tyr/sagas/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Foundation')).toBeInTheDocument();
  });

  it('renders branch tag', () => {
    render(
      <MemoryRouter initialEntries={['/tyr/sagas/saga-1']}>
        <Routes>
          <Route path="/tyr/sagas/:id" element={<DetailView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('feat/auth')).toBeInTheDocument();
  });
});
