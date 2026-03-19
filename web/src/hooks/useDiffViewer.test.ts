import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiffViewer } from './useDiffViewer';
import type { DiffData } from '@/models';

// Mock the adapters module
const mockGetSessionDiff = vi.fn();
vi.mock('@/adapters', () => ({
  volundrService: {
    getSessionDiff: (...args: unknown[]) => mockGetSessionDiff(...args),
  },
}));

vi.mock('@/adapters/api/client', () => ({
  getAccessToken: vi.fn(() => null),
}));

const mockDiff: DiffData = {
  filePath: 'src/main.ts',
  hunks: [
    {
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 5,
      lines: [
        { type: 'context', content: 'line 1', oldLine: 1, newLine: 1 },
        { type: 'add', content: 'new line', newLine: 2 },
        { type: 'remove', content: 'old line', oldLine: 2 },
      ],
    },
  ],
};

describe('useDiffViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionDiff.mockResolvedValue(mockDiff);
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useDiffViewer());

    expect(result.current.diff).toBeNull();
    expect(result.current.diffLoading).toBe(false);
    expect(result.current.diffError).toBeNull();
    expect(result.current.selectedFile).toBeNull();
    expect(result.current.diffBase).toBe('last-commit');
    expect(result.current.files).toEqual([]);
    expect(result.current.filesLoading).toBe(false);
  });

  it('fetches diff when selecting a file (no chatEndpoint, falls back to volundrService)', async () => {
    const { result } = renderHook(() => useDiffViewer());

    await act(async () => {
      await result.current.selectFile('session-1', 'src/main.ts');
    });

    expect(mockGetSessionDiff).toHaveBeenCalledWith('session-1', 'src/main.ts', 'last-commit');
    expect(result.current.diff).toEqual(mockDiff);
    expect(result.current.selectedFile).toBe('src/main.ts');
    expect(result.current.diffLoading).toBe(false);
  });

  it('sets error when fetch fails', async () => {
    mockGetSessionDiff.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useDiffViewer());

    await act(async () => {
      await result.current.selectFile('session-1', 'src/main.ts');
    });

    expect(result.current.diff).toBeNull();
    expect(result.current.diffError?.message).toBe('Network error');
  });

  it('wraps non-Error rejection in Error', async () => {
    mockGetSessionDiff.mockRejectedValue('string error');

    const { result } = renderHook(() => useDiffViewer());

    await act(async () => {
      await result.current.selectFile('session-1', 'src/main.ts');
    });

    expect(result.current.diffError?.message).toBe('Failed to fetch diff');
  });

  it('clears diff state', async () => {
    const { result } = renderHook(() => useDiffViewer());

    await act(async () => {
      await result.current.selectFile('session-1', 'src/main.ts');
    });

    expect(result.current.diff).not.toBeNull();

    act(() => {
      result.current.clearDiff();
    });

    expect(result.current.diff).toBeNull();
    expect(result.current.selectedFile).toBeNull();
    expect(result.current.diffError).toBeNull();
    expect(result.current.files).toEqual([]);
  });

  it('clears selection and updates base when changing diff base', async () => {
    const { result } = renderHook(() => useDiffViewer());

    // First select a file
    await act(async () => {
      await result.current.selectFile('session-1', 'src/main.ts');
    });

    expect(result.current.selectedFile).toBe('src/main.ts');
    expect(result.current.diff).toEqual(mockDiff);

    // Change base — should clear selection and diff
    act(() => {
      result.current.setDiffBase('default-branch');
    });

    expect(result.current.diffBase).toBe('default-branch');
    expect(result.current.selectedFile).toBeNull();
    expect(result.current.diff).toBeNull();
    expect(result.current.diffError).toBeNull();
  });

  it('updates base without errors when no file is selected', () => {
    const { result } = renderHook(() => useDiffViewer());

    act(() => {
      result.current.setDiffBase('default-branch');
    });

    expect(mockGetSessionDiff).not.toHaveBeenCalled();
    expect(result.current.diffBase).toBe('default-branch');
  });

  it('re-fetches files from Skuld when changing diff base', async () => {
    const mockFiles = [{ path: 'README.md', status: 'mod', ins: 3, del: 1 }];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ files: mockFiles }),
    } as Response);

    const { result } = renderHook(() =>
      useDiffViewer('wss://sessions.example.com/s/abc-123/session')
    );

    await act(async () => {
      result.current.setDiffBase('default-branch');
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'https://sessions.example.com/s/abc-123/api/diff/files?base=default-branch'
      ),
      expect.objectContaining({ headers: {} })
    );
    expect(result.current.files).toEqual(mockFiles);

    fetchSpy.mockRestore();
  });

  it('does not fetch files when no chatEndpoint', async () => {
    const { result } = renderHook(() => useDiffViewer());

    await act(async () => {
      await result.current.fetchFiles();
    });

    expect(result.current.files).toEqual([]);
  });

  it('fetches files directly from Skuld when chatEndpoint is provided', async () => {
    const mockFiles = [{ path: 'README.md', status: 'mod', ins: 3, del: 1 }];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ files: mockFiles }),
    } as Response);

    const { result } = renderHook(() =>
      useDiffViewer('wss://sessions.example.com/s/abc-123/session')
    );

    await act(async () => {
      await result.current.fetchFiles();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://sessions.example.com/s/abc-123/api/diff/files'),
      expect.objectContaining({ headers: {} })
    );
    expect(result.current.files).toEqual(mockFiles);
    expect(mockGetSessionDiff).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('fetches diff directly from Skuld when chatEndpoint is provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDiff),
    } as Response);

    const { result } = renderHook(() =>
      useDiffViewer('wss://sessions.example.com/s/abc-123/session')
    );

    await act(async () => {
      await result.current.selectFile('abc-123', 'src/main.ts');
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://sessions.example.com/s/abc-123/api/diff?'),
      expect.objectContaining({ headers: {} })
    );
    expect(result.current.diff).toEqual(mockDiff);
    expect(mockGetSessionDiff).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it('falls back to volundrService when Skuld fetch returns non-ok', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const { result } = renderHook(() =>
      useDiffViewer('wss://sessions.example.com/s/abc-123/session')
    );

    await act(async () => {
      await result.current.selectFile('abc-123', 'src/main.ts');
    });

    expect(mockGetSessionDiff).toHaveBeenCalledWith('abc-123', 'src/main.ts', 'last-commit');
    expect(result.current.diff).toEqual(mockDiff);

    fetchSpy.mockRestore();
  });

  it('fetchFiles sets empty files on network error (catch branch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() =>
      useDiffViewer('wss://sessions.example.com/s/abc-123/session')
    );

    await act(async () => {
      await result.current.fetchFiles();
    });

    expect(result.current.files).toEqual([]);
    fetchSpy.mockRestore();
  });

  it('fetchFiles handles non-ok response without setting files', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const { result } = renderHook(() =>
      useDiffViewer('wss://sessions.example.com/s/abc-123/session')
    );

    await act(async () => {
      await result.current.fetchFiles();
    });

    expect(result.current.files).toEqual([]);
    fetchSpy.mockRestore();
  });

  it('refetchFiles sets empty files on error (catch branch via setDiffBase)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() =>
      useDiffViewer('wss://sessions.example.com/s/abc-123/session')
    );

    await act(async () => {
      result.current.setDiffBase('default-branch');
    });

    // Wait for the refetch to complete
    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(result.current.files).toEqual([]);
    fetchSpy.mockRestore();
  });

  it('refetchFiles skips fetch when apiBase is null', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useDiffViewer(null));

    await act(async () => {
      result.current.setDiffBase('default-branch');
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('buildApiBase returns null for invalid chatEndpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { result } = renderHook(() => useDiffViewer('not-a-valid-url'));

    await act(async () => {
      await result.current.fetchFiles();
    });

    // apiBase is null, so fetch should not be called
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('buildApiBase converts ws: to http: protocol', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    } as Response);

    const { result } = renderHook(() =>
      useDiffViewer('ws://sessions.example.com/s/abc-123/session')
    );

    await act(async () => {
      await result.current.fetchFiles();
    });

    const fetchUrl = fetchSpy.mock.calls[0][0] as string;
    expect(fetchUrl).toMatch(/^http:/);
    fetchSpy.mockRestore();
  });

  it('includes auth headers when access token exists', async () => {
    const { getAccessToken } = await import('@/adapters/api/client');
    vi.mocked(getAccessToken).mockReturnValue('my-token');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ files: [] }),
    } as Response);

    const { result } = renderHook(() =>
      useDiffViewer('wss://sessions.example.com/s/abc-123/session')
    );

    await act(async () => {
      await result.current.fetchFiles();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { Authorization: 'Bearer my-token' },
      })
    );
    fetchSpy.mockRestore();
  });

  it('refetchFiles handles non-ok response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const { result } = renderHook(() =>
      useDiffViewer('wss://sessions.example.com/s/abc-123/session')
    );

    await act(async () => {
      result.current.setDiffBase('default-branch');
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Non-ok doesn't update files — they stay empty from initial state
    expect(result.current.files).toEqual([]);
    fetchSpy.mockRestore();
  });
});
