import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTyrSessions } from './useTyrSessions';

const mockSessions = [
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
];

describe('useTyrSessions', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockSessions,
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch sessions on mount', async () => {
    const { result } = renderHook(() => useTyrSessions());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0].name).toBe('niu-201');
  });

  it('should handle fetch error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useTyrSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Network error');
    expect(result.current.sessions).toHaveLength(0);
  });

  it('should return getTimeline function', async () => {
    const { result } = renderHook(() => useTyrSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(typeof result.current.getTimeline).toBe('function');
  });
});
