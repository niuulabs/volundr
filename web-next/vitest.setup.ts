import '@testing-library/jest-dom/vitest';

// Radix UI Popover / floating elements need ResizeObserver
if (typeof ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Radix UI Toast swipe gestures need hasPointerCapture on DOM elements
if (!window.Element.prototype.hasPointerCapture) {
  window.Element.prototype.hasPointerCapture = () => false;
}
if (!window.Element.prototype.setPointerCapture) {
  window.Element.prototype.setPointerCapture = () => {};
}
if (!window.Element.prototype.releasePointerCapture) {
  window.Element.prototype.releasePointerCapture = () => {};
}
