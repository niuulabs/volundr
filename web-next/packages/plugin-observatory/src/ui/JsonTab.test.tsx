import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { JsonTab } from './JsonTab';
import type { TypeRegistry } from '../domain/registry';

const REGISTRY: TypeRegistry = {
  version: 3,
  updatedAt: '2026-01-01T00:00:00Z',
  types: [
    {
      id: 'realm',
      label: 'Realm',
      rune: 'ᛞ',
      icon: 'globe',
      shape: 'ring',
      color: 'ice-100',
      size: 18,
      border: 'solid',
      canContain: ['cluster'],
      parentTypes: [],
      category: 'topology',
      description: 'A realm.',
      fields: [],
    },
  ],
};

describe('JsonTab', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders the registry JSON in a pre block', () => {
    render(<JsonTab registry={REGISTRY} />);
    const pre = screen.getByLabelText('Registry JSON');
    expect(pre).toBeInTheDocument();
    expect(pre.textContent).toContain('"version": 3');
    expect(pre.textContent).toContain('"realm"');
  });

  it('renders a copy button', () => {
    render(<JsonTab registry={REGISTRY} />);
    expect(screen.getByRole('button', { name: 'Copy JSON to clipboard' })).toBeInTheDocument();
  });

  it('shows "Copied!" after clicking the copy button', async () => {
    render(<JsonTab registry={REGISTRY} />);
    const btn = screen.getByRole('button', { name: 'Copy JSON to clipboard' });
    fireEvent.click(btn);
    // After click the navigator.clipboard.writeText resolves and state updates
    await screen.findByText('Copied!');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      JSON.stringify(REGISTRY, null, 2),
    );
  });

  it('pretty-prints the JSON with 2-space indent', () => {
    render(<JsonTab registry={REGISTRY} />);
    const pre = screen.getByLabelText('Registry JSON');
    expect(pre.textContent).toBe(JSON.stringify(REGISTRY, null, 2));
  });
});
