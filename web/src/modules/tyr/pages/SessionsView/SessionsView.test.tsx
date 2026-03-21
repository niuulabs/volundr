import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionsView } from './SessionsView';

vi.mock('../../hooks', () => ({
  useTyrSessions: () => ({
    sessions: [
      {
        session_id: 'sess-001',
        status: 'running',
        chronicle_lines: ['Building project...', 'Tests passing'],
      },
      {
        session_id: 'sess-002',
        status: 'review',
        chronicle_lines: ['Waiting for approval'],
      },
    ],
    loading: false,
    error: null,
    approve: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe('SessionsView', () => {
  it('renders session cards', () => {
    render(<SessionsView />);
    expect(screen.getByText('sess-001')).toBeInTheDocument();
    expect(screen.getByText('sess-002')).toBeInTheDocument();
  });

  it('renders chronicle lines', () => {
    render(<SessionsView />);
    expect(screen.getByText('Building project...')).toBeInTheDocument();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
  });

  it('renders approve buttons', () => {
    render(<SessionsView />);
    const buttons = screen.getAllByText('Approve');
    expect(buttons).toHaveLength(2);
  });
});
