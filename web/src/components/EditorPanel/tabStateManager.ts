/**
 * Persists open editor tabs per session so they can be restored
 * when the user switches back to a previously visited session.
 *
 * Tab state is stored in-memory (lost on page reload). Each entry
 * records the file paths relative to the workspace root and which
 * tab was active, allowing reconstruction of URIs for any session.
 */

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
export async function saveTabState(sessionId: string): Promise<void> {
  const vscode = await import('vscode');

  const tabs: SavedTab[] = [];
  const activeTabUri = vscode.window.tabGroups.activeTabGroup?.activeTab?.input;

  for (const group of vscode.window.tabGroups.all) {
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
export async function restoreTabState(sessionId: string, authority: string): Promise<void> {
  const saved = tabStateBySession.get(sessionId);
  if (!saved || saved.length === 0) {
    return;
  }

  const vscode = await import('vscode');

  // Open each saved tab. Save the active one for last so it ends up focused.
  let activeTab: SavedTab | null = null;

  for (const tab of saved) {
    if (tab.isActive) {
      activeTab = tab;
      continue;
    }
    await openTab(vscode, sessionId, authority, tab);
  }

  // Open the active tab last so it gets focus.
  if (activeTab) {
    await openTab(vscode, sessionId, authority, activeTab);
  }
}

async function openTab(
  vscode: typeof import('vscode'),
  sessionId: string,
  authority: string,
  tab: SavedTab
): Promise<void> {
  const uri = vscode.Uri.from({
    scheme: 'vscode-remote',
    authority,
    path: `/volundr/sessions/${sessionId}/workspace/${tab.relativePath}`,
  });

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: !tab.isActive });
  } catch {
    // File may no longer exist — skip silently.
  }
}

/** Clear all saved state. Exposed for testing only. @internal */
export function resetTabStateManager(): void {
  tabStateBySession.clear();
}
