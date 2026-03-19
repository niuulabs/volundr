/**
 * Persists open editor tabs per session so they can be restored
 * when the user switches back to a previously visited session.
 *
 * Tab state is stored in-memory (lost on page reload). Each entry
 * records the file paths relative to the workspace root and which
 * tab was active, allowing reconstruction of URIs for any session.
 *
 * The VS Code API is passed in as a parameter (not imported directly)
 * because the `vscode` module is a virtual module provided at runtime
 * by @codingame/monaco-vscode-api and cannot be resolved by Vite at
 * build time.
 */

/** Minimal subset of the VS Code API needed by the tab state manager. */
export interface VsCodeApi {
  Uri: {
    from(components: { scheme: string; authority?: string; path?: string }): {
      scheme: string;
      authority: string;
      path: string;
    };
  };
  window: {
    tabGroups: {
      all: readonly {
        tabs: readonly {
          input: unknown;
        }[];
      }[];
      activeTabGroup: {
        activeTab: { input: unknown } | undefined;
      };
    };
    showTextDocument(
      document: unknown,
      options?: { preview?: boolean; preserveFocus?: boolean }
    ): Thenable<unknown>;
  };
  workspace: {
    openTextDocument(uri: unknown): Thenable<unknown>;
  };
}

export interface SavedTab {
  /** Path relative to the workspace root (e.g. "src/main.ts"). */
  relativePath: string;
  /** Whether this tab was the active/focused one. */
  isActive: boolean;
}

const tabStateBySession = new Map<string, SavedTab[]>();

/** Workspace path prefix: /volundr/sessions/{id}/workspace/ */
const WORKSPACE_PREFIX_RE = /^\/volundr\/sessions\/[^/]+\/workspace\//;

/**
 * Extract the relative path from a full vscode-remote URI path.
 * Returns null if the path doesn't match the expected workspace layout.
 */
export function extractRelativePath(fullPath: string): string | null {
  const match = fullPath.match(WORKSPACE_PREFIX_RE);
  if (!match) {
    return null;
  }
  return fullPath.slice(match[0].length);
}

/**
 * Save the currently open editor tabs for the given session.
 *
 * Reads from `vscode.window.tabGroups` to discover all open text
 * editor tabs and their active state.
 */
export async function saveTabState(sessionId: string, api: VsCodeApi): Promise<void> {
  const tabs: SavedTab[] = [];
  const activeTabUri = api.window.tabGroups.activeTabGroup?.activeTab?.input;

  for (const group of api.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      // TabInputText has a `uri` property — filter to text editor tabs only.
      if (input && typeof input === 'object' && 'uri' in input) {
        const uri = (input as { uri: { path: string; scheme: string } }).uri;
        if (uri.scheme !== 'vscode-remote') {
          continue;
        }
        const relativePath = extractRelativePath(uri.path);
        if (!relativePath) {
          continue;
        }
        const isActive =
          activeTabUri != null &&
          typeof activeTabUri === 'object' &&
          'uri' in activeTabUri &&
          (activeTabUri as { uri: { path: string } }).uri.path === uri.path;

        tabs.push({ relativePath, isActive });
      }
    }
  }

  tabStateBySession.set(sessionId, tabs);
}

/**
 * Retrieve the saved tab state for a session (if any).
 */
export function getSavedTabState(sessionId: string): SavedTab[] | undefined {
  return tabStateBySession.get(sessionId);
}

/**
 * Restore previously saved tabs for a session.
 *
 * Opens each saved file and focuses the one that was previously active.
 * Operates on a best-effort basis — files that no longer exist are skipped.
 */
export async function restoreTabState(
  sessionId: string,
  authority: string,
  api: VsCodeApi
): Promise<void> {
  const saved = tabStateBySession.get(sessionId);
  if (!saved || saved.length === 0) {
    return;
  }

  // Open each saved tab. Save the active one for last so it ends up focused.
  let activeTab: SavedTab | null = null;

  for (const tab of saved) {
    if (tab.isActive) {
      activeTab = tab;
      continue;
    }
    await openTab(api, sessionId, authority, tab);
  }

  // Open the active tab last so it gets focus.
  if (activeTab) {
    await openTab(api, sessionId, authority, activeTab);
  }
}

async function openTab(
  api: VsCodeApi,
  sessionId: string,
  authority: string,
  tab: SavedTab
): Promise<void> {
  const uri = api.Uri.from({
    scheme: 'vscode-remote',
    authority,
    path: `/volundr/sessions/${sessionId}/workspace/${tab.relativePath}`,
  });

  try {
    const doc = await api.workspace.openTextDocument(uri);
    await api.window.showTextDocument(doc, { preview: false, preserveFocus: !tab.isActive });
  } catch {
    // File may no longer exist — skip silently.
  }
}

/** Clear all saved state. Exposed for testing only. @internal */
export function resetTabStateManager(): void {
  tabStateBySession.clear();
}
