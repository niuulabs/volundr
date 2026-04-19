import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver or scrollIntoView — polyfill for tests
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
