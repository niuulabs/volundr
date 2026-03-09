import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AppearanceSection } from './AppearanceSection';

const store: Record<string, string> = {};

const localStorageMock = {
  getItem: vi.fn((k: string) => store[k] ?? null),
  setItem: vi.fn((k: string, v: string) => {
    store[k] = v;
  }),
  removeItem: vi.fn((k: string) => {
    delete store[k];
  }),
  clear: vi.fn(() => {
    for (const k of Object.keys(store)) delete store[k];
  }),
  key: vi.fn(),
  length: 0,
};

function renderAppearance() {
  return render(
    <ThemeProvider>
      <AppearanceSection />
    </ThemeProvider>
  );
}

describe('AppearanceSection', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.restoreAllMocks();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders theme heading', () => {
    renderAppearance();
    expect(screen.getByText('Theme')).toBeDefined();
  });

  it('renders all theme options', () => {
    renderAppearance();
    expect(screen.getByText('Volundr Amber')).toBeDefined();
    expect(screen.getByText('Spring Green')).toBeDefined();
  });

  it('highlights active theme card', () => {
    renderAppearance();
    const amberButton = screen.getByText('Volundr Amber').closest('button')!;
    expect(amberButton.className).toContain('cardActive');
  });

  it('switches theme on click', () => {
    renderAppearance();
    const springButton = screen.getByText('Spring Green').closest('button')!;
    fireEvent.click(springButton);

    expect(springButton.className).toContain('cardActive');
    expect(document.documentElement.getAttribute('data-theme')).toBe('spring');
  });

  it('switches back to default theme', () => {
    renderAppearance();

    fireEvent.click(screen.getByText('Spring Green'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('spring');

    fireEvent.click(screen.getByText('Volundr Amber'));
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});
