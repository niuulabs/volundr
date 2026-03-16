/**
 * Singleton state tracking for the VS Code workbench initialization.
 *
 * `initialize()` from @codingame/monaco-vscode-api can only be called
 * once per page load. This module tracks whether it has been called
 * and which session it was initialized for.
 *
 * @internal — only consumed by EditorPanel and its tests.
 */

let initialized = false;
let initializedSessionId: string | null = null;

export function isInitialized(): boolean {
  return initialized;
}

export function getInitializedSessionId(): string | null {
  return initializedSessionId;
}

export function markInitialized(sessionId: string): void {
  initialized = true;
  initializedSessionId = sessionId;
}

/**
 * Reset the initialization state. Exposed for testing only.
 * @internal
 */
export function resetEditorState(): void {
  initialized = false;
  initializedSessionId = null;
}
