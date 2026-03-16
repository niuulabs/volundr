import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Mock workbenchInit to prevent @codingame/monaco-vscode-* CSS imports
// from breaking the test environment (Node.js can't handle .css files).
vi.mock('@/components/EditorPanel/workbenchInit', () => ({
  initWorkbench: vi.fn().mockResolvedValue(undefined),
}));

// Polyfill ResizeObserver for assistant-ui components that use it
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}

// Cleanup after each test
afterEach(() => {
  cleanup();
});
