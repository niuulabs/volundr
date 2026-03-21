/**
 * Singleton state tracking for the VS Code workbench initialization.
 *
 * `initialize()` from @codingame/monaco-vscode-api can only be called
 * once per page load. This module tracks whether it has been called.
 *
 * Session-specific routing is handled by sessionRouter.ts — the
 * workbench is initialized once and can serve multiple sessions.
 *
 * @internal — only consumed by EditorPanel and its tests.
 */

let initialized = false;

export function isInitialized(): boolean {
  return initialized;
}

export function markInitialized(): void {
  initialized = true;
}

/**
 * Reset the initialization state. Exposed for testing only.
 * @internal
 */
export function resetEditorState(): void {
  initialized = false;
}
