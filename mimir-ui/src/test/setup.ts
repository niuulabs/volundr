import '@testing-library/jest-dom';

// Mock ResizeObserver (not available in jsdom)
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock WebSocket
global.WebSocket = class {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  readyState = 0;
  close() {}
} as unknown as typeof WebSocket;

// Mock import.meta.env
Object.defineProperty(import.meta, 'env', {
  value: {
    VITE_MIMIR_INSTANCES: undefined,
    VITE_MIMIR_TARGET: undefined,
  },
  writable: true,
});
