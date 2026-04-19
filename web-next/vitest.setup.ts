import '@testing-library/jest-dom/vitest';

// TanStack Router calls window.scrollTo during scroll-restoration inside tests.
// jsdom doesn't implement it; stub it out to keep test output clean.
Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });

// Radix UI uses ResizeObserver (e.g. Tooltip/Popover arrow sizing).
// jsdom doesn't implement it; provide a no-op stub.
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Radix UI Toast swipe detection calls hasPointerCapture on DOM elements.
// jsdom doesn't implement it; stub it on Element.prototype.
if (typeof Element.prototype.hasPointerCapture === 'undefined') {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture === 'undefined') {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture === 'undefined') {
  Element.prototype.releasePointerCapture = () => {};
}
