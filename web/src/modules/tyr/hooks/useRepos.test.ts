import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRepos } from './useRepos';

describe('useRepos', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        github: [{ url: 'https://github.com/org/repo', name: 'repo', default_branch: 'main' }],
      }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch and flatten repos on mount', async () => {
    const { result } = renderHook(() => useRepos());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.repos).toHaveLength(1);
    expect(result.current.repos[0].name).toBe('repo');
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useRepos());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('fail');
  });

  it('should handle non-Error rejection', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue('string error');
    const { result } = renderHook(() => useRepos());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('string error');
  });

  it('should not update state after unmount', async () => {
    // Slow fetch to allow unmount before resolution
    let resolvePromise: (v: Response) => void;
    vi.spyOn(global, 'fetch').mockReturnValue(
      new Promise(r => {
        resolvePromise = r;
      })
    );
    const { result, unmount } = renderHook(() => useRepos());
    expect(result.current.loading).toBe(true);
    unmount();
    // Resolve after unmount — should not throw
    resolvePromise!({ ok: true, status: 200, json: async () => ({}) } as Response);
  });
});
