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

// jsdom doesn't implement Element.prototype.scrollIntoView.
// Radix UI and ValidationSummary use it in focus-jump flows.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom doesn't implement PointerEvent methods used by Radix UI primitives.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
