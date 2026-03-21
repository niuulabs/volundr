import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SagasView } from './SagasView';

vi.mock('../../hooks', () => ({
  useSagas: () => ({
    sagas: [
      {
        id: 'saga-1',
        tracker_id: 'PROJ-100',
        tracker_type: 'linear',
        slug: 'my-saga',
        name: 'Implement auth flow',
        repo: 'niuulabs/app',
        feature_branch: 'feat/auth',
        status: 'active',
        confidence: 0.82,
        created_at: '2026-01-01T00:00:00Z',
      },
    ],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

describe('SagasView', () => {
  it('renders saga data', () => {
    render(
      <MemoryRouter>
        <SagasView />
      </MemoryRouter>,
    );

    expect(screen.getByText('Implement auth flow')).toBeInTheDocument();
    expect(screen.getByText('PROJ-100')).toBeInTheDocument();
    expect(screen.getByText('niuulabs/app')).toBeInTheDocument();
  });

  it('renders metric cards', () => {
    render(
      <MemoryRouter>
        <SagasView />
      </MemoryRouter>,
    );

    expect(screen.getByText('Total Sagas')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Avg Confidence')).toBeInTheDocument();
  });

  it('shows confidence values', () => {
    render(
      <MemoryRouter>
        <SagasView />
      </MemoryRouter>,
    );

    const matches = screen.getAllByText('82%');
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});
