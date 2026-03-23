import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('renders token count', () => {
    render(<SessionsView />);
    expect(screen.getByText('1,234 tokens')).toBeInTheDocument();
  });

  it('renders tracker issue id', () => {
    render(<SessionsView />);
    expect(screen.getByText('NIU-201')).toBeInTheDocument();
  });

  it('renders model name', () => {
    render(<SessionsView />);
    expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument();
  });

  it('renders different status colors', () => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [
        {
          id: 's1',
          name: 'stopped-session',
          model: 'claude-sonnet-4-6',
          source: { repo: '', branch: '' },
          status: 'stopped',
          chat_endpoint: null,
          code_endpoint: null,
          created_at: '2026-03-22T10:00:00Z',
          updated_at: '2026-03-22T10:00:00Z',
          last_active: '2026-03-22T10:00:00Z',
          message_count: 0,
          tokens_used: 0,
          tracker_issue_id: null,
          issue_tracker_url: null,
          error: null,
        },
        {
          id: 's2',
          name: 'failed-session',
          model: 'claude-sonnet-4-6',
          source: { repo: '', branch: '' },
          status: 'failed',
          chat_endpoint: null,
          code_endpoint: null,
          created_at: '2026-03-22T10:00:00Z',
          updated_at: '2026-03-22T10:00:00Z',
          last_active: '2026-03-22T10:00:00Z',
          message_count: 0,
          tokens_used: 0,
          tracker_issue_id: null,
          issue_tracker_url: null,
          error: 'OOM killed',
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
      getTimeline: vi.fn(),
    });
    render(<SessionsView />);
    expect(screen.getByText('stopped')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('expands session on click and shows detail', async () => {
    const mockGetTimeline = vi.fn().mockResolvedValue({
      events: [
        { t: 60, type: 'message', label: 'Hello', tokens: 100 },
        { t: 120, type: 'file', label: 'src/main.py' },
        { t: 180, type: 'git', label: 'commit abc' },
        { t: 240, type: 'terminal', label: 'npm test' },
        { t: 300, type: 'error', label: 'fail' },
        { t: 360, type: 'session', label: 'started' },
      ],
      files: [
        { path: 'src/main.py', status: 'new', ins: 10, del: 0 },
        { path: 'src/old.py', status: 'mod', ins: 5, del: 3 },
        { path: 'src/removed.py', status: 'del', ins: 0, del: 20 },
      ],
      commits: [{ hash: 'abc1234', msg: 'feat: add feature', time: '14:30' }],
      token_burn: [100, 200],
    });
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [
        {
          id: 'sess-1',
          name: 'niu-201',
          model: 'claude-sonnet-4-6',
          source: { repo: 'github.com/org/repo', branch: 'feat/test' },
          status: 'running',
          chat_endpoint: 'https://example.com/chat',
          code_endpoint: 'https://example.com/code',
          created_at: '2026-03-22T10:00:00Z',
          updated_at: '2026-03-22T10:00:00Z',
          last_active: '2026-03-22T10:05:00Z',
          message_count: 5,
          tokens_used: 1234,
          tracker_issue_id: 'NIU-201',
          issue_tracker_url: 'https://linear.app/issue',
          error: null,
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
      getTimeline: mockGetTimeline,
    });
    render(<SessionsView />);
    fireEvent.click(screen.getByText('niu-201'));
    await waitFor(() => {
      expect(screen.getByText('abc1234')).toBeInTheDocument();
    });
    expect(screen.getByText('feat: add feature')).toBeInTheDocument();
    expect(screen.getAllByText('src/main.py').length).toBeGreaterThan(0);
    expect(screen.getByText('Open Editor')).toBeInTheDocument();
    expect(screen.getByText('Tracker Issue')).toBeInTheDocument();
  });

  it('shows error on session with error', () => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [
        {
          id: 's1',
          name: 'err-session',
          model: 'm',
          source: { repo: '', branch: '' },
          status: 'failed',
          chat_endpoint: null,
          code_endpoint: null,
          created_at: '2026-03-22T10:00:00Z',
          updated_at: '2026-03-22T10:00:00Z',
          last_active: '2026-03-22T10:00:00Z',
          message_count: 0,
          tokens_used: 0,
          tracker_issue_id: null,
          issue_tracker_url: null,
          error: 'OOM killed',
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
      getTimeline: vi.fn(),
    });
    render(<SessionsView />);
    // Expand to see error
    fireEvent.click(screen.getByText('err-session'));
    expect(screen.getByText('OOM killed')).toBeInTheDocument();
  });

  it('renders all status types for color coverage', () => {
    const statuses = ['running', 'stopped', 'completed', 'failed', 'starting', 'creating', 'other'];
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: statuses.map((status, i) => ({
        id: `s${i}`,
        name: `${status}-session`,
        model: 'm',
        source: { repo: '', branch: '' },
        status,
        chat_endpoint: null,
        code_endpoint: null,
        created_at: '2026-03-22T10:00:00Z',
        updated_at: '2026-03-22T10:00:00Z',
        last_active: '2026-03-22T10:00:00Z',
        message_count: 0,
        tokens_used: 0,
        tracker_issue_id: null,
        issue_tracker_url: null,
        error: null,
      })),
      loading: false,
      error: null,
      refresh: vi.fn(),
      getTimeline: vi.fn(),
    });
    render(<SessionsView />);
    for (const status of statuses) {
      expect(screen.getByText(status)).toBeInTheDocument();
    }
  });

  it('sorts sessions by status (running first)', () => {
    vi.mocked(hooks.useTyrSessions).mockReturnValue({
      sessions: [
        {
          id: 's1',
          name: 'stopped-one',
          model: 'm',
          source: { repo: '', branch: '' },
          status: 'stopped',
          chat_endpoint: null,
          code_endpoint: null,
          created_at: '2026-03-22T10:00:00Z',
          updated_at: '2026-03-22T10:00:00Z',
          last_active: '2026-03-22T10:00:00Z',
          message_count: 0,
          tokens_used: 0,
          tracker_issue_id: null,
          issue_tracker_url: null,
          error: null,
        },
        {
          id: 's2',
          name: 'running-one',
          model: 'm',
          source: { repo: '', branch: '' },
          status: 'running',
          chat_endpoint: null,
          code_endpoint: null,
          created_at: '2026-03-22T10:00:00Z',
          updated_at: '2026-03-22T10:00:00Z',
          last_active: '2026-03-22T10:00:00Z',
          message_count: 0,
          tokens_used: 0,
          tracker_issue_id: null,
          issue_tracker_url: null,
          error: null,
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(),
      getTimeline: vi.fn(),
    });
    render(<SessionsView />);
    const names = screen.getAllByRole('button').map(b => b.textContent);
    const runningIdx = names.findIndex(n => n?.includes('running-one'));
    const stoppedIdx = names.findIndex(n => n?.includes('stopped-one'));
    expect(runningIdx).toBeLessThan(stoppedIdx);
  });
});
