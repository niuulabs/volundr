import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhaseBlock } from './PhaseBlock';
import type { Phase } from '../../models';

const mockPhase: Phase = {
  id: 'phase-1',
  saga_id: 'saga-1',
  tracker_id: 'PROJ-10',
  number: 1,
  name: 'Foundation',
  status: 'active',
  confidence: 0.72,
  raids: [
    {
      id: 'raid-1',
      phase_id: 'phase-1',
      tracker_id: 'PROJ-11',
      name: 'Setup project structure',
      description: 'Initialize the project',
      acceptance_criteria: ['Project compiles'],
      declared_files: ['src/index.ts'],
      estimate_hours: 1,
      status: 'merged',
      confidence: 0.95,
      session_id: null,
      branch: 'feat/setup',
      chronicle_summary: null,
      retry_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'raid-2',
      phase_id: 'phase-1',
      tracker_id: 'PROJ-12',
      name: 'Add database schema',
      description: 'Create initial DB schema',
      acceptance_criteria: ['Migrations run'],
      declared_files: ['migrations/001.sql'],
      estimate_hours: 2,
      status: 'running',
      confidence: 0.6,
      session_id: 'sess-1',
      branch: 'feat/db-schema',
      chronicle_summary: null,
      retry_count: 0,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
};

describe('PhaseBlock', () => {
  it('renders phase name', () => {
    render(<PhaseBlock phase={mockPhase} />);
    expect(screen.getByText('Foundation')).toBeInTheDocument();
  });

  it('renders phase number', () => {
    render(<PhaseBlock phase={mockPhase} />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders raids', () => {
    render(<PhaseBlock phase={mockPhase} />);
    expect(screen.getByText('Setup project structure')).toBeInTheDocument();
    expect(screen.getByText('Add database schema')).toBeInTheDocument();
  });

  it('renders empty message when no raids', () => {
    render(<PhaseBlock phase={{ ...mockPhase, raids: [] }} />);
    expect(screen.getByText('No raids in this phase')).toBeInTheDocument();
  });

  it('renders phase status badge', () => {
    render(<PhaseBlock phase={mockPhase} />);
    expect(screen.getByText('active')).toBeInTheDocument();
  });
});
