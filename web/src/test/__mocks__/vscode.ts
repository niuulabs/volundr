/**
 * Stub for the `vscode` module used in tests.
 *
 * The real `vscode` module is provided by the VS Code extension host at
 * runtime. This file gives Vite a resolvable path so its import analysis
 * doesn't fail. The actual mock behaviour is set up in setup.ts via
 * vi.mock('vscode') — which takes precedence at test time.
 */

export const Uri = {
  from: (c: Record<string, string>) => ({
    scheme: c.scheme,
    authority: c.authority,
    path: c.path,
  }),
  parse: (v: string) => ({ scheme: '', authority: '', path: v }),
};

export const workspace = {
  workspaceFolders: [] as unknown[],
  updateWorkspaceFolders: () => true,
  openTextDocument: async () => ({ uri: {} }),
};

export const window = {
  tabGroups: { all: [], activeTabGroup: { activeTab: null } },
  showTextDocument: async () => ({}),
};

export const commands = {
  executeCommand: async () => undefined,
};
