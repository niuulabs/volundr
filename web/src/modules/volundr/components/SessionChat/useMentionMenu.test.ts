import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMentionMenu } from './useMentionMenu';

vi.mock('@/modules/volundr/adapters/api/client', () => ({
  getAccessToken: vi.fn(() => null),
}));

// Mock global fetch for Skuld pod /api/files calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockFetchResponse(entries: Array<{ name: string; path: string; type: string }>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ entries }),
  });
}

const DEFAULT_FILES = [
  { name: 'src', path: 'src', type: 'directory' },
  { name: 'package.json', path: 'package.json', type: 'file' },
  { name: 'README.md', path: 'README.md', type: 'file' },
];

describe('useMentionMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchResponse(DEFAULT_FILES);
  });

  it('starts closed with no mentions', () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.filter).toBe('');
    expect(result.current.selectedIndex).toBe(0);
    expect(result.current.mentions).toEqual([]);
  });

  it('opens when input contains @ preceded by whitespace', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('hello @', 7);
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.filter).toBe('');
  });

  it('opens when input starts with @', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    expect(result.current.isOpen).toBe(true);
  });

  it('does not open when @ is inside a word', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('email@', 6);
    });

    expect(result.current.isOpen).toBe(false);
  });

  it('filters items by name', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@pack', 5);
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.filter).toBe('pack');
    // Filtered items should only include package.json
    const filtered = result.current.items;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].entry.name).toBe('package.json');
  });

  it('closes when @ trigger is followed by space', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@src ', 5);
    });

    expect(result.current.isOpen).toBe(false);
  });

  it('fetches files from Skuld pod when opening', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    expect(mockFetch).toHaveBeenCalledWith('https://pod.local/api/files', { headers: {} });
  });

  it('uses chatEndpoint to build gateway URL with path prefix', async () => {
    const { result } = renderHook(() =>
      useMentionMenu('session-1', null, 'wss://gateway.example.com/s/abc-123/session')
    );

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    expect(mockFetch).toHaveBeenCalledWith('https://gateway.example.com/s/abc-123/api/files', {
      headers: {},
    });
  });

  it('handles chatEndpoint with /api/session suffix', async () => {
    const { result } = renderHook(() =>
      useMentionMenu('session-1', null, 'wss://gateway.example.com/s/abc-123/api/session')
    );

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    expect(mockFetch).toHaveBeenCalledWith('https://gateway.example.com/s/abc-123/api/files', {
      headers: {},
    });
  });

  it('prefers chatEndpoint over sessionHost', async () => {
    const { result } = renderHook(() =>
      useMentionMenu('session-1', 'pod.local', 'wss://gateway.example.com/s/abc-123/session')
    );

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    expect(mockFetch).toHaveBeenCalledWith('https://gateway.example.com/s/abc-123/api/files', {
      headers: {},
    });
  });

  it('includes auth token in fetch headers when available', async () => {
    const { getAccessToken } = await import('@/modules/volundr/adapters/api/client');
    vi.mocked(getAccessToken).mockReturnValue('test-token');

    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    expect(mockFetch).toHaveBeenCalledWith('https://pod.local/api/files', {
      headers: { Authorization: 'Bearer test-token' },
    });

    vi.mocked(getAccessToken).mockReturnValue(null);
  });

  it('does not fetch files when sessionHost is null', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', null));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty items when fetch fails', async () => {
    mockFetch.mockReset();
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    expect(result.current.items).toHaveLength(0);
    // Should not crash
    expect(result.current.isOpen).toBe(true);
  });

  it('returns empty items when fetch returns non-ok', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    expect(result.current.items).toHaveLength(0);
  });

  it('selectItem adds entry to mentions and closes menu', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    const item = result.current.items[1]; // package.json

    let selectedPath = '';
    act(() => {
      selectedPath = result.current.selectItem(item);
    });

    expect(selectedPath).toBe('package.json');
    expect(result.current.isOpen).toBe(false);
    expect(result.current.mentions).toHaveLength(1);
    expect(result.current.mentions[0].path).toBe('package.json');
  });

  it('selectItem does not add duplicate mentions', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    const item = result.current.items[1]; // package.json

    act(() => {
      result.current.selectItem(item);
    });

    // Re-open and select same item
    mockFetchResponse(DEFAULT_FILES);
    await act(async () => {
      result.current.handleChange('@', 1);
    });

    act(() => {
      result.current.selectItem(result.current.items[1]);
    });

    expect(result.current.mentions).toHaveLength(1);
  });

  it('removeMention removes entry from mentions', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    act(() => {
      result.current.selectItem(result.current.items[1]);
    });

    expect(result.current.mentions).toHaveLength(1);

    act(() => {
      result.current.removeMention('package.json');
    });

    expect(result.current.mentions).toHaveLength(0);
  });

  it('close() resets menu state', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@pack', 5);
    });

    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.close();
    });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.filter).toBe('');
    expect(result.current.selectedIndex).toBe(0);
  });

  it('handleKeyDown returns false when menu is closed', () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({
        key: 'ArrowDown',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(handled).toBe(false);
  });

  it('handleKeyDown Escape closes menu', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({
        key: 'Escape',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(handled).toBe(true);
    expect(result.current.isOpen).toBe(false);
  });

  it('handleKeyDown ArrowDown cycles selection forward', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowDown',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(result.current.selectedIndex).toBe(1);
  });

  it('handleKeyDown ArrowUp wraps to last item', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowUp',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    // Wraps to last item (index 2 for 3 items)
    expect(result.current.selectedIndex).toBe(2);
  });

  it('handleKeyDown Enter returns true when items available', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({
        key: 'Enter',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(handled).toBe(true);
  });

  it('handleKeyDown Tab expands selected directory', async () => {
    mockFetch.mockReset();
    mockFetchResponse([
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'package.json', path: 'package.json', type: 'file' },
    ]);
    mockFetchResponse([{ name: 'App.tsx', path: 'src/App.tsx', type: 'file' }]);

    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    // First item is src directory
    expect(result.current.items[0].entry.type).toBe('directory');

    await act(async () => {
      result.current.handleKeyDown({
        key: 'Tab',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(mockFetch).toHaveBeenCalledWith('https://pod.local/api/files?path=src', { headers: {} });
  });

  it('handleKeyDown returns false for unhandled keys', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    let handled = false;
    act(() => {
      handled = result.current.handleKeyDown({
        key: 'a',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    expect(handled).toBe(false);
  });

  it('expandDirectory loads children and inserts after parent', async () => {
    mockFetch.mockReset();
    mockFetchResponse([
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'tests', path: 'tests', type: 'directory' },
    ]);
    mockFetchResponse([
      { name: 'App.tsx', path: 'src/App.tsx', type: 'file' },
      { name: 'main.tsx', path: 'src/main.tsx', type: 'file' },
    ]);

    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    expect(result.current.items).toHaveLength(2);

    await act(async () => {
      result.current.expandDirectory(result.current.items[0]); // expand src
    });

    expect(result.current.items).toHaveLength(4);
    expect(result.current.items[0].entry.name).toBe('src');
    expect(result.current.items[1].entry.name).toBe('App.tsx');
    expect(result.current.items[1].depth).toBe(1);
    expect(result.current.items[2].entry.name).toBe('main.tsx');
    expect(result.current.items[3].entry.name).toBe('tests');
  });

  it('expandDirectory collapses already expanded directory', async () => {
    mockFetch.mockReset();
    mockFetchResponse([{ name: 'src', path: 'src', type: 'directory' }]);
    mockFetchResponse([{ name: 'App.tsx', path: 'src/App.tsx', type: 'file' }]);

    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    // Expand
    await act(async () => {
      result.current.expandDirectory(result.current.items[0]);
    });

    expect(result.current.items).toHaveLength(2);

    // Collapse
    await act(async () => {
      result.current.expandDirectory(result.current.items[0]);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].entry.name).toBe('src');
  });

  it('fuzzy matches file names (e.g. "pkg" matches "package.json")', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@pkg', 4);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].entry.name).toBe('package.json');
  });

  it('fuzzy matches partial sequences (e.g. "rdm" matches "README.md")', async () => {
    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@rdm', 4);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].entry.name).toBe('README.md');
  });

  it('keeps parent directories visible when children match filter', async () => {
    mockFetch.mockReset();
    mockFetchResponse([
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'tests', path: 'tests', type: 'directory' },
    ]);
    mockFetchResponse([
      { name: 'App.tsx', path: 'src/App.tsx', type: 'file' },
      { name: 'main.tsx', path: 'src/main.tsx', type: 'file' },
    ]);

    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    // Expand src
    await act(async () => {
      result.current.expandDirectory(result.current.items[0]);
    });

    // Filter for "app" — should show src (parent) and App.tsx
    await act(async () => {
      result.current.handleChange('@app', 4);
    });

    const names = result.current.items.map(i => i.entry.name);
    expect(names).toContain('src');
    expect(names).toContain('App.tsx');
    expect(names).not.toContain('tests');
    expect(names).not.toContain('main.tsx');
  });

  it('matches full path when filter contains slash', async () => {
    mockFetch.mockReset();
    mockFetchResponse([{ name: 'src', path: 'src', type: 'directory' }]);
    mockFetchResponse([{ name: 'App.tsx', path: 'src/App.tsx', type: 'file' }]);

    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    await act(async () => {
      result.current.expandDirectory(result.current.items[0]);
    });

    await act(async () => {
      result.current.handleChange('@src/app', 8);
    });

    const names = result.current.items.map(i => i.entry.name);
    expect(names).toContain('src');
    expect(names).toContain('App.tsx');
  });

  it('Enter on directory expands it instead of selecting', async () => {
    mockFetch.mockReset();
    mockFetchResponse([
      { name: 'src', path: 'src', type: 'directory' },
      { name: 'file.txt', path: 'file.txt', type: 'file' },
    ]);
    mockFetchResponse([{ name: 'App.tsx', path: 'src/App.tsx', type: 'file' }]);

    const { result } = renderHook(() => useMentionMenu('session-1', 'pod.local'));

    await act(async () => {
      result.current.handleChange('@', 1);
    });

    // First item is src directory, press Enter
    await act(async () => {
      result.current.handleKeyDown({
        key: 'Enter',
        preventDefault: () => {},
      } as React.KeyboardEvent);
    });

    // Menu should still be open (directory expanded, not selected)
    expect(result.current.isOpen).toBe(true);
    // Should have fetched children
    expect(mockFetch).toHaveBeenCalledWith('https://pod.local/api/files?path=src', { headers: {} });
  });
});
