import '@testing-library/jest-dom/vitest';

// TanStack Router calls window.scrollTo during scroll-restoration inside tests.
// jsdom doesn't implement it; stub it out to keep test output clean.
Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });
