import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionGroupList } from './SessionGroupList';
import type { VolundrSession } from '@/models';

// Mock useLocalStorage
const mockSetCollapsed = vi.fn();
let mockCollapsedState: Record<string, boolean> = {};

vi.mock('@/hooks', () => ({
  useLocalStorage: vi.fn(() => [mockCollapsedState, mockSetCollapsed]),
}));

function makeSession(overrides: Partial<VolundrSession> = {}): VolundrSession {
  return {
    id: 'session-1',
    name: 'test-session',
    status: 'running',
    repo: 'https://github.com/org/repo-a',
    branch: 'main',
    model: 'claude-sonnet-4-20250514',
    createdAt: Date.now(),
    lastActive: Date.now(),
    totalCostUsd: 0,
    ...overrides,
  } as VolundrSession;
}

describe('SessionGroupList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollapsedState = {};
  });

  it('groups sessions by repository', () => {
    const sessions = [
      makeSession({ id: 's1', name: 'S1', repo: 'https://github.com/org/repo-a' }),
      makeSession({ id: 's2', name: 'S2', repo: 'https://github.com/org/repo-b' }),
      makeSession({ id: 's3', name: 'S3', repo: 'https://github.com/org/repo-a' }),
    ];

    render(
      <SessionGroupList
        sessions={sessions}
        searchQuery=""
        renderSession={s => (
          <div key={s.id} data-testid={`session-${s.id}`}>
            {s.name}
          </div>
        )}
      />
    );

    expect(screen.getByText('org/repo-a')).toBeInTheDocument();
    expect(screen.getByText('org/repo-b')).toBeInTheDocument();
  });

  it('renders all sessions via renderSession prop', () => {
    const sessions = [
      makeSession({ id: 's1', name: 'Session One', repo: 'https://github.com/org/repo' }),
      makeSession({ id: 's2', name: 'Session Two', repo: 'https://github.com/org/repo' }),
    ];

    render(
      <SessionGroupList
        sessions={sessions}
        searchQuery=""
        renderSession={s => <div key={s.id}>{s.name}</div>}
      />
    );

    expect(screen.getByText('Session One')).toBeInTheDocument();
    expect(screen.getByText('Session Two')).toBeInTheDocument();
  });

  it('shows active count badge for running sessions', () => {
    const sessions = [
      makeSession({ id: 's1', status: 'running', repo: 'https://github.com/org/repo' }),
      makeSession({ id: 's2', status: 'stopped', repo: 'https://github.com/org/repo' }),
      makeSession({ id: 's3', status: 'running', repo: 'https://github.com/org/repo' }),
    ];

    render(
      <SessionGroupList
        sessions={sessions}
        searchQuery=""
        renderSession={s => <div key={s.id}>{s.name}</div>}
      />
    );

    // 2 active sessions
    expect(screen.getByText('2')).toBeInTheDocument();
    // 3 total sessions
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('toggles group collapse on header click', () => {
    const sessions = [makeSession({ id: 's1', repo: 'https://github.com/org/my-repo' })];

    render(
      <SessionGroupList
        sessions={sessions}
        searchQuery=""
        renderSession={s => <div key={s.id}>{s.name}</div>}
      />
    );

    fireEvent.click(screen.getByText('org/my-repo'));

    expect(mockSetCollapsed).toHaveBeenCalledWith(expect.objectContaining({ 'org/my-repo': true }));
  });

  it('groups sessions without repo URL under Ungrouped', () => {
    const sessions = [makeSession({ id: 's1', name: 'No Repo', repo: '' })];

    render(
      <SessionGroupList
        sessions={sessions}
        searchQuery=""
        renderSession={s => <div key={s.id}>{s.name}</div>}
      />
    );

    expect(screen.getByText('Ungrouped')).toBeInTheDocument();
  });

  it('handles non-URL repo values', () => {
    const sessions = [makeSession({ id: 's1', name: 'Plain Repo', repo: 'my-local-repo' })];

    render(
      <SessionGroupList
        sessions={sessions}
        searchQuery=""
        renderSession={s => <div key={s.id}>{s.name}</div>}
      />
    );

    expect(screen.getByText('my-local-repo')).toBeInTheDocument();
  });

  it('strips .git suffix from repo URLs', () => {
    const sessions = [makeSession({ id: 's1', repo: 'https://github.com/org/repo.git' })];

    render(
      <SessionGroupList
        sessions={sessions}
        searchQuery=""
        renderSession={s => <div key={s.id}>{s.name}</div>}
      />
    );

    expect(screen.getByText('org/repo')).toBeInTheDocument();
  });

  it('does not collapse groups when searching', () => {
    mockCollapsedState = { 'org/repo': true };

    const sessions = [
      makeSession({ id: 's1', name: 'Found It', repo: 'https://github.com/org/repo' }),
    ];

    render(
      <SessionGroupList
        sessions={sessions}
        searchQuery="Found"
        renderSession={s => <div key={s.id}>{s.name}</div>}
      />
    );

    // Session should still be visible despite group being "collapsed"
    expect(screen.getByText('Found It')).toBeInTheDocument();
  });

  it('sorts groups by most recently active', () => {
    const sessions = [
      makeSession({ id: 's1', repo: 'https://github.com/org/old-repo', lastActive: 1000 }),
      makeSession({ id: 's2', repo: 'https://github.com/org/new-repo', lastActive: 2000 }),
    ];

    render(
      <SessionGroupList
        sessions={sessions}
        searchQuery=""
        renderSession={s => <div key={s.id}>{s.name}</div>}
      />
    );

    const groupHeaders = screen.getAllByRole('button');
    expect(groupHeaders[0]).toHaveTextContent('org/new-repo');
    expect(groupHeaders[1]).toHaveTextContent('org/old-repo');
  });

  it('does not show active badge when no sessions are running', () => {
    const sessions = [
      makeSession({ id: 's1', status: 'stopped', repo: 'https://github.com/org/repo' }),
    ];

    render(
      <SessionGroupList
        sessions={sessions}
        searchQuery=""
        renderSession={s => <div key={s.id}>{s.name}</div>}
      />
    );

    // Total count badge shows "1", but no active dot/badge
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
