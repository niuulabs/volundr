import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TypesTab } from './TypesTab';
import type { TypeRegistry } from '../domain/registry';

const REGISTRY: TypeRegistry = {
  version: 1,
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
      description: 'A realm. Network zone.',
      fields: [],
    },
    {
      id: 'cluster',
      label: 'Cluster',
      rune: 'ᚲ',
      icon: 'layers',
      shape: 'ring-dashed',
      color: 'ice-200',
      size: 14,
      border: 'dashed',
      canContain: ['service'],
      parentTypes: ['realm'],
      category: 'topology',
      description: 'A cluster. Kubernetes.',
      fields: [],
    },
    {
      id: 'ravn',
      label: 'Ravn',
      rune: 'ᚱ',
      icon: 'bird',
      shape: 'diamond',
      color: 'brand',
      size: 11,
      border: 'solid',
      canContain: [],
      parentTypes: ['cluster'],
      category: 'agent',
      description: 'An agent.',
      fields: [],
    },
  ],
};

describe('TypesTab', () => {
  it('renders all types grouped by category', () => {
    render(<TypesTab registry={REGISTRY} selectedId={undefined} onSelect={vi.fn()} />);
    expect(screen.getByText('Realm')).toBeInTheDocument();
    expect(screen.getByText('Cluster')).toBeInTheDocument();
    expect(screen.getByText('Ravn')).toBeInTheDocument();
  });

  it('renders category headings', () => {
    render(<TypesTab registry={REGISTRY} selectedId={undefined} onSelect={vi.fn()} />);
    expect(screen.getByText('topology')).toBeInTheDocument();
    expect(screen.getByText('agent')).toBeInTheDocument();
  });

  it('renders the search input', () => {
    render(<TypesTab registry={REGISTRY} selectedId={undefined} onSelect={vi.fn()} />);
    expect(screen.getByRole('searchbox', { name: 'Filter entity types' })).toBeInTheDocument();
  });

  it('filters types by label on search', () => {
    render(<TypesTab registry={REGISTRY} selectedId={undefined} onSelect={vi.fn()} />);
    const input = screen.getByRole('searchbox', { name: 'Filter entity types' });
    fireEvent.change(input, { target: { value: 'ravn' } });
    expect(screen.getByText('Ravn')).toBeInTheDocument();
    expect(screen.queryByText('Realm')).not.toBeInTheDocument();
    expect(screen.queryByText('Cluster')).not.toBeInTheDocument();
  });

  it('filters types by id on search', () => {
    render(<TypesTab registry={REGISTRY} selectedId={undefined} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cluster' } });
    expect(screen.getByText('Cluster')).toBeInTheDocument();
    expect(screen.queryByText('Realm')).not.toBeInTheDocument();
  });

  it('shows empty state when nothing matches', () => {
    render(<TypesTab registry={REGISTRY} selectedId={undefined} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzznomatch' } });
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Realm')).not.toBeInTheDocument();
  });

  it('marks the selected card with aria-pressed', () => {
    render(<TypesTab registry={REGISTRY} selectedId="realm" onSelect={vi.fn()} />);
    const realmBtn = screen.getByRole('button', { name: /Realm \(realm\)/ });
    expect(realmBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onSelect when a card is clicked', () => {
    const onSelect = vi.fn();
    render(<TypesTab registry={REGISTRY} selectedId={undefined} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Cluster \(cluster\)/ }));
    expect(onSelect).toHaveBeenCalledWith('cluster');
  });

  it('shows shape in the type meta', () => {
    render(<TypesTab registry={REGISTRY} selectedId={undefined} onSelect={vi.fn()} />);
    expect(screen.getByText('ring')).toBeInTheDocument();
  });
});
