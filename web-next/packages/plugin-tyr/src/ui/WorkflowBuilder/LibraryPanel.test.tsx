import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LibraryPanel, DEFAULT_PERSONAS } from './LibraryPanel';

describe('LibraryPanel', () => {
  it('renders the library-panel container', () => {
    render(<LibraryPanel personas={DEFAULT_PERSONAS} />);
    expect(screen.getByTestId('library-panel')).toBeInTheDocument();
  });

  it('renders a chip for each persona', () => {
    render(<LibraryPanel personas={DEFAULT_PERSONAS} />);
    for (const persona of DEFAULT_PERSONAS) {
      expect(screen.getByTestId(`persona-chip-${persona.id}`)).toBeInTheDocument();
    }
  });

  it('displays persona labels', () => {
    render(<LibraryPanel personas={DEFAULT_PERSONAS} />);
    expect(screen.getByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('Builder')).toBeInTheDocument();
  });

  it('renders with custom personas', () => {
    const custom = [{ id: 'custom-1', label: 'Custom', role: 'custom' }];
    render(<LibraryPanel personas={custom} />);
    expect(screen.getByTestId('persona-chip-custom-1')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
  });

  it('renders with empty personas list', () => {
    render(<LibraryPanel personas={[]} />);
    expect(screen.getByTestId('library-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('persona-chip-persona-plan')).toBeNull();
  });

  it('chips are draggable', () => {
    render(<LibraryPanel personas={DEFAULT_PERSONAS} />);
    const chip = screen.getByTestId(`persona-chip-${DEFAULT_PERSONAS[0]!.id}`);
    expect(chip).toHaveAttribute('draggable', 'true');
  });

  it('DEFAULT_PERSONAS has 6 entries', () => {
    expect(DEFAULT_PERSONAS).toHaveLength(6);
  });

  it('DEFAULT_PERSONAS all have unique ids', () => {
    const ids = DEFAULT_PERSONAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
