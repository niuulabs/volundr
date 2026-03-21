import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTyrSessions } from './useTyrSessions';
import { tyrSessionService } from '../adapters';
import type { SessionInfo } from '../models';

vi.mock('../adapters', () => ({
  tyrSessionService: {
    getSessions: vi.fn(),
    getSession: vi.fn(),
    approve: vi.fn(),
  },
}));

const mockSessions: SessionInfo[] = [
  {
    session_id: 'sess-1002',
    status: 'running',
    chronicle_lines: ['[09:15] Started raid NIU-102'],
  },
  {
    session_id: 'sess-1004',
    status: 'review',
    chronicle_lines: ['[14:00] Started raid NIU-104'],
  },
];

describe('useTyrSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tyrSessionService.getSessions).mockResolvedValue(mockSessions);
    vi.mocked(tyrSessionService.approve).mockResolvedValue(undefined);
  });

  it('should fetch sessions on mount', async () => {
    const { result } = renderHook(() => useTyrSessions());

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.sessions).toEqual(mockSessions);
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.mocked(tyrSessionService.getSessions).mockRejectedValue(new Error('Service unavailable'));

    const { result } = renderHook(() => useTyrSessions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Service unavailable');
  });

  it('should approve a session and refresh', async () => {
    const approvedSessions = mockSessions.map(s =>
      s.session_id === 'sess-1004' ? { ...s, status: 'approved' } : s
    );
    vi.mocked(tyrSessionService.getSessions)
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(approvedSessions);

    const { result } = renderHook(() => useTyrSessions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.approve('sess-1004');
    });

    expect(tyrSessionService.approve).toHaveBeenCalledWith('sess-1004');
    expect(result.current.sessions).toEqual(approvedSessions);
  });
});
