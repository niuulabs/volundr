import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionsView } from './SessionsView';

vi.mock('../../hooks', () => ({
  useTyrSessions: vi.fn(),
}));

vi.mock('@/modules/shared', () => ({
  LoadingIndicator: ({ messages }: { messages?: string[] }) => (
    <div data-testid="loading-indicator">{messages?.[0]}</div>
  ),
}));

import * as hooks from '../../hooks';

describe('SessionsView', () => {
  beforeEach(() => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [
        {
          id: 'sess-1',
          name: 'niu-201',
          model: 'claude-sonnet-4-6',
          source: { repo: 'github.com/org/repo', branch: 'feat/test' },
          status: 'running',
          chat_endpoint: null,
          code_endpoint: null,
          created_at: '2026-03-22T10:00:00Z',
          updated_at: '2026-03-22T10:00:00Z',
          last_active: '2026-03-22T10:05:00Z',
          message_count: 5,
          tokens_used: 1234,
          tracker_issue_id: 'NIU-201',
          issue_tracker_url: null,
          error: null,
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
      getTimeline: vi.fn(),
    });
  });

  it('renders session data', () => {
    render(<SessionsView />);
    expect(screen.getByText('niu-201')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('renders loading indicator', () => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [],
      loading: true,
      error: null,
      refresh: vi.fn(),
      getTimeline: vi.fn(),
    });
    render(<SessionsView />);
    expect(screen.getByText('Loading sessions...')).toBeInTheDocument();
  });

  it('renders error message', () => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [],
      loading: false,
      error: 'Network error',
      refresh: vi.fn(),
      getTimeline: vi.fn(),
    });
    render(<SessionsView />);
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
      getTimeline: vi.fn(),
    });
    render(<SessionsView />);
    expect(screen.getByText('No sessions')).toBeInTheDocument();
  });

  it('renders session stats', () => {
    render(<SessionsView />);
    expect(screen.getByText('1 running')).toBeInTheDocument();
    expect(screen.getByText('1 total')).toBeInTheDocument();
  });
});
