import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VsCodeApi } from './tabStateManager';
import {
  extractRelativePath,
  saveTabState,
  getSavedTabState,
  restoreTabState,
  resetTabStateManager,
} from './tabStateManager';

function createMockApi(): VsCodeApi & {
  _showTextDocument: ReturnType<typeof vi.fn>;
  _openTextDocument: ReturnType<typeof vi.fn>;
  _tabGroups: {
    all: { tabs: { input: { uri: { path: string; scheme: string } } }[] }[];
    activeTabGroup: { activeTab: { input: { uri: { path: string } } } | null };
  };
} {
  const showTextDocument = vi.fn().mockResolvedValue({});
  const openTextDocument = vi.fn().mockResolvedValue({ uri: {} });
  const tabGroups = {
    all: [] as { tabs: { input: { uri: { path: string; scheme: string } } }[] }[],
    activeTabGroup: { activeTab: null as { input: { uri: { path: string } } } | null },
  };

  return {
    Uri: {
      from: (c: { scheme: string; authority?: string; path?: string }) => ({
        scheme: c.scheme,
        authority: c.authority ?? '',
        path: c.path ?? '',
      }),
    },
    window: {
      get tabGroups() {
        return tabGroups;
      },
      showTextDocument: showTextDocument,
    },
    workspace: {
      openTextDocument: openTextDocument,
    },
    _showTextDocument: showTextDocument,
    _openTextDocument: openTextDocument,
    _tabGroups: tabGroups,
  };
}

describe('tabStateManager', () => {
  let api: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    resetTabStateManager();
    api = createMockApi();
  });

  describe('extractRelativePath', () => {
    it('should extract relative path from workspace URI path', () => {
      const fullPath = '/volundr/sessions/abc-123/workspace/src/main.ts';
      expect(extractRelativePath(fullPath)).toBe('src/main.ts');
    });

    it('should handle nested paths', () => {
      const fullPath = '/volundr/sessions/abc-123/workspace/src/components/App/App.tsx';
      expect(extractRelativePath(fullPath)).toBe('src/components/App/App.tsx');
    });

    it('should return null for non-matching paths', () => {
      expect(extractRelativePath('/some/other/path/file.ts')).toBeNull();
    });

    it('should return empty string for workspace root', () => {
      const fullPath = '/volundr/sessions/abc-123/workspace/';
      expect(extractRelativePath(fullPath)).toBe('');
    });
  });

  describe('saveTabState', () => {
    it('should save open tabs for a session', async () => {
      api._tabGroups.all = [
        {
          tabs: [
            {
              input: {
                uri: { path: '/volundr/sessions/s1/workspace/src/a.ts', scheme: 'vscode-remote' },
              },
            },
            {
              input: {
                uri: { path: '/volundr/sessions/s1/workspace/src/b.ts', scheme: 'vscode-remote' },
              },
            },
          ],
        },
      ];
      api._tabGroups.activeTabGroup = {
        activeTab: {
          input: { uri: { path: '/volundr/sessions/s1/workspace/src/b.ts' } },
        },
      };

      await saveTabState('s1', api);

      const saved = getSavedTabState('s1');
      expect(saved).toHaveLength(2);
      expect(saved![0]).toEqual({ relativePath: 'src/a.ts', isActive: false });
      expect(saved![1]).toEqual({ relativePath: 'src/b.ts', isActive: true });
    });

    it('should skip non-vscode-remote tabs', async () => {
      api._tabGroups.all = [
        {
          tabs: [
            {
              input: {
                uri: { path: '/volundr/sessions/s1/workspace/src/a.ts', scheme: 'vscode-remote' },
              },
            },
            { input: { uri: { path: '/some/local/file.ts', scheme: 'file' } } },
          ],
        },
      ];

      await saveTabState('s1', api);

      const saved = getSavedTabState('s1');
      expect(saved).toHaveLength(1);
      expect(saved![0].relativePath).toBe('src/a.ts');
    });

    it('should save empty array when no tabs are open', async () => {
      await saveTabState('s1', api);

      const saved = getSavedTabState('s1');
      expect(saved).toEqual([]);
    });
  });

  describe('restoreTabState', () => {
    it('should restore previously saved tabs', async () => {
      api._tabGroups.all = [
        {
          tabs: [
            {
              input: {
                uri: { path: '/volundr/sessions/s1/workspace/src/a.ts', scheme: 'vscode-remote' },
              },
            },
            {
              input: {
                uri: { path: '/volundr/sessions/s1/workspace/src/b.ts', scheme: 'vscode-remote' },
              },
            },
          ],
        },
      ];
      api._tabGroups.activeTabGroup = {
        activeTab: {
          input: { uri: { path: '/volundr/sessions/s1/workspace/src/b.ts' } },
        },
      };

      await saveTabState('s1', api);

      // Reset mocks for restore phase.
      api._openTextDocument.mockClear();
      api._showTextDocument.mockClear();

      await restoreTabState('s1', 'gateway.example.com', api);

      // Non-active tab opened first, then active tab last for focus.
      expect(api._openTextDocument).toHaveBeenCalledTimes(2);
      expect(api._showTextDocument).toHaveBeenCalledTimes(2);

      // First call: non-active tab (src/a.ts)
      const firstUri = api._openTextDocument.mock.calls[0][0];
      expect(firstUri.path).toBe('/volundr/sessions/s1/workspace/src/a.ts');

      // Second call: active tab (src/b.ts)
      const secondUri = api._openTextDocument.mock.calls[1][0];
      expect(secondUri.path).toBe('/volundr/sessions/s1/workspace/src/b.ts');
    });

    it('should do nothing when no saved state exists', async () => {
      await restoreTabState('nonexistent', 'gateway.example.com', api);

      expect(api._openTextDocument).not.toHaveBeenCalled();
    });

    it('should skip files that fail to open', async () => {
      api._tabGroups.all = [
        {
          tabs: [
            {
              input: {
                uri: { path: '/volundr/sessions/s1/workspace/gone.ts', scheme: 'vscode-remote' },
              },
            },
          ],
        },
      ];

      await saveTabState('s1', api);
      api._openTextDocument.mockRejectedValueOnce(new Error('File not found'));

      // Should not throw.
      await expect(restoreTabState('s1', 'gateway.example.com', api)).resolves.toBeUndefined();
    });
  });

  describe('getSavedTabState', () => {
    it('should return undefined for unknown sessions', () => {
      expect(getSavedTabState('unknown')).toBeUndefined();
    });
  });
});
