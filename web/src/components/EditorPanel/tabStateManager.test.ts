import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  extractRelativePath,
  saveTabState,
  getSavedTabState,
  restoreTabState,
  resetTabStateManager,
} from './tabStateManager';

// Mock the vscode module
const mockExecuteCommand = vi.fn();
const mockShowTextDocument = vi.fn().mockResolvedValue({});
const mockOpenTextDocument = vi.fn().mockResolvedValue({ uri: {} });

const mockTabGroups = {
  all: [] as { tabs: { input: { uri: { path: string; scheme: string } } }[] }[],
  activeTabGroup: { activeTab: null as { input: { uri: { path: string } } } | null },
};

vi.mock('vscode', () => ({
  window: {
    get tabGroups() {
      return mockTabGroups;
    },
    showTextDocument: (...args: unknown[]) => mockShowTextDocument(...args),
  },
  workspace: {
    openTextDocument: (...args: unknown[]) => mockOpenTextDocument(...args),
  },
  commands: {
    executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
  },
  Uri: {
    from: (components: { scheme: string; authority: string; path: string }) => ({
      scheme: components.scheme,
      authority: components.authority,
      path: components.path,
    }),
  },
}));

describe('tabStateManager', () => {
  beforeEach(() => {
    resetTabStateManager();
    vi.clearAllMocks();
    mockTabGroups.all = [];
    mockTabGroups.activeTabGroup = { activeTab: null };
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
      mockTabGroups.all = [
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
      mockTabGroups.activeTabGroup = {
        activeTab: {
          input: { uri: { path: '/volundr/sessions/s1/workspace/src/b.ts' } },
        },
      };

      await saveTabState('s1');

      const saved = getSavedTabState('s1');
      expect(saved).toHaveLength(2);
      expect(saved![0]).toEqual({ relativePath: 'src/a.ts', isActive: false });
      expect(saved![1]).toEqual({ relativePath: 'src/b.ts', isActive: true });
    });

    it('should skip non-vscode-remote tabs', async () => {
      mockTabGroups.all = [
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
      mockTabGroups.activeTabGroup = { activeTab: null };

      await saveTabState('s1');

      const saved = getSavedTabState('s1');
      expect(saved).toHaveLength(1);
      expect(saved![0].relativePath).toBe('src/a.ts');
    });

    it('should save empty array when no tabs are open', async () => {
      mockTabGroups.all = [];

      await saveTabState('s1');

      const saved = getSavedTabState('s1');
      expect(saved).toEqual([]);
    });
  });

  describe('restoreTabState', () => {
    it('should restore previously saved tabs', async () => {
      // Manually seed saved state by calling save with mock tabs.
      mockTabGroups.all = [
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
      mockTabGroups.activeTabGroup = {
        activeTab: {
          input: { uri: { path: '/volundr/sessions/s1/workspace/src/b.ts' } },
        },
      };

      await saveTabState('s1');
      vi.clearAllMocks();

      // Now restore.
      await restoreTabState('s1', 'gateway.example.com');

      // Non-active tab opened first, then active tab last for focus.
      expect(mockOpenTextDocument).toHaveBeenCalledTimes(2);
      expect(mockShowTextDocument).toHaveBeenCalledTimes(2);

      // First call: non-active tab (src/a.ts)
      const firstUri = mockOpenTextDocument.mock.calls[0][0];
      expect(firstUri.path).toBe('/volundr/sessions/s1/workspace/src/a.ts');

      // Second call: active tab (src/b.ts)
      const secondUri = mockOpenTextDocument.mock.calls[1][0];
      expect(secondUri.path).toBe('/volundr/sessions/s1/workspace/src/b.ts');
    });

    it('should do nothing when no saved state exists', async () => {
      await restoreTabState('nonexistent', 'gateway.example.com');

      expect(mockOpenTextDocument).not.toHaveBeenCalled();
    });

    it('should skip files that fail to open', async () => {
      mockTabGroups.all = [
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
      mockTabGroups.activeTabGroup = { activeTab: null };

      await saveTabState('s1');
      vi.clearAllMocks();

      mockOpenTextDocument.mockRejectedValueOnce(new Error('File not found'));

      // Should not throw.
      await expect(restoreTabState('s1', 'gateway.example.com')).resolves.toBeUndefined();
    });
  });

  describe('getSavedTabState', () => {
    it('should return undefined for unknown sessions', () => {
      expect(getSavedTabState('unknown')).toBeUndefined();
    });
  });
});
