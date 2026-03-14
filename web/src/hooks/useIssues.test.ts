import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useIssues } from './useIssues';

describe('useIssues', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with empty state', () => {
    const { result } = renderHook(() => useIssues());

    expect(result.current.issues).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('searchIssues fetches and sets issues', async () => {
    const mockIssues = [
      {
        id: '1',
        identifier: 'NIU-42',
        title: 'Fix auth',
        status: 'In Progress',
        assignee: null,
        labels: [],
        priority: 1,
        url: 'https://linear.app/issue/NIU-42',
      },
    ];
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockIssues),
    } as Response);

    const { result } = renderHook(() => useIssues());

    await act(async () => {
      await result.current.searchIssues('auth');
    });

    expect(result.current.issues).toEqual(mockIssues);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith('/api/v1/volundr/issues/search?q=auth', {
      credentials: 'include',
    });
  });

  it('searchIssues handles errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const { result } = renderHook(() => useIssues());

    await act(async () => {
      await result.current.searchIssues('broken');
    });

    expect(result.current.issues).toEqual([]);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('getIssue returns issue on success', async () => {
    const mockIssue = {
      id: '1',
      identifier: 'NIU-42',
      title: 'Fix auth',
      status: 'Done',
      assignee: null,
      labels: [],
      priority: 0,
      url: 'https://linear.app/issue/NIU-42',
    };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockIssue),
    } as Response);

    const { result } = renderHook(() => useIssues());

    let issue;
    await act(async () => {
      issue = await result.current.getIssue('NIU-42');
    });

    expect(issue).toEqual(mockIssue);
  });

  it('getIssue returns null on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHook(() => useIssues());

    let issue;
    await act(async () => {
      issue = await result.current.getIssue('NONEXISTENT');
    });

    expect(issue).toBeNull();
  });

  it('getIssue returns null on network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() => useIssues());

    let issue;
    await act(async () => {
      issue = await result.current.getIssue('NIU-99');
    });

    expect(issue).toBeNull();
  });
});
