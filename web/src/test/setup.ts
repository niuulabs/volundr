import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Mock the vscode module — it only exists at runtime inside the VS Code
// extension host, and Vite cannot resolve it during tests.
vi.mock('vscode', () => ({
  Uri: {
    from: (c: Record<string, string>) => ({
      scheme: c.scheme,
      authority: c.authority,
      path: c.path,
    }),
  },
  workspace: {
    workspaceFolders: [],
    updateWorkspaceFolders: vi.fn(),
    openTextDocument: vi.fn().mockResolvedValue({ uri: {} }),
  },
  window: {
    tabGroups: { all: [], activeTabGroup: { activeTab: null } },
    showTextDocument: vi.fn().mockResolvedValue({}),
  },
  commands: {
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock workbenchInit to prevent @codingame/monaco-vscode-* CSS imports
// from breaking the test environment (Node.js can't handle .css files).
vi.mock('@/components/EditorPanel/workbenchInit', () => ({
  initWorkbench: vi.fn().mockResolvedValue(undefined),
  switchSession: vi.fn().mockResolvedValue(undefined),
}));

// Polyfill scrollIntoView — jsdom does not implement it
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
}

// Polyfill ResizeObserver for assistant-ui components that use it
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(_callback?: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}

// Polyfill localStorage — jsdom may provide a broken Storage in some contexts
if (
  typeof globalThis.localStorage === 'undefined' ||
  typeof globalThis.localStorage.getItem !== 'function'
) {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

// Cleanup after each test
afterEach(() => {
  cleanup();
});
