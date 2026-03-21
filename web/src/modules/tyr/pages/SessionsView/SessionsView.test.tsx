import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionsView } from './SessionsView';
import * as hooks from '../../hooks';

vi.mock('../../hooks', () => ({
  useTyrSessions: vi.fn(),
}));

vi.mock('@/modules/shared', () => ({
  LoadingIndicator: ({ messages, label }: { messages?: string[]; label?: string }) => (
    <div data-testid="loading-indicator">{messages?.[0] ?? label}</div>
  ),
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
}));

describe('SessionsView', () => {
  beforeEach(() => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
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
    } as ReturnType<typeof hooks.useTyrSessions>);
  });

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

  it('renders loading indicator when loading', () => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [],
      loading: true,
      error: null,
      approve: vi.fn(),
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useTyrSessions>);

    render(<SessionsView />);
    expect(screen.getByText('Loading sessions...')).toBeInTheDocument();
  });

  it('renders error message when error occurs', () => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [],
      loading: false,
      error: 'Server error',
      approve: vi.fn(),
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useTyrSessions>);

    render(<SessionsView />);
    expect(screen.getByText('Server error')).toBeInTheDocument();
  });

  it('renders empty state when no sessions exist', () => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [],
      loading: false,
      error: null,
      approve: vi.fn(),
      refresh: vi.fn(),
    } as ReturnType<typeof hooks.useTyrSessions>);

    render(<SessionsView />);
    expect(screen.getByText('No active sessions')).toBeInTheDocument();
  });
});
