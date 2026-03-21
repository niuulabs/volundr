import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RaidRow } from './RaidRow';
import type { Raid } from '../../models';

const mockRaid: Raid = {
  id: 'raid-1',
  phase_id: 'phase-1',
  tracker_id: 'PROJ-101',
  name: 'Implement login form',
  description: 'Build the login form component',
  acceptance_criteria: ['Form renders', 'Validation works'],
  declared_files: ['src/Login.tsx'],
  estimate_hours: 2,
  status: 'running',
  confidence: 0.8,
  session_id: 'session-1',
  branch: 'feat/login-form',
  chronicle_summary: null,
  retry_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('RaidRow', () => {
  it('renders raid name', () => {
    render(<RaidRow raid={mockRaid} />);
    expect(screen.getByText('Implement login form')).toBeInTheDocument();
  });

  it('shows confidence badge', () => {
    render(<RaidRow raid={mockRaid} />);
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('shows raid status badge', () => {
    render(<RaidRow raid={mockRaid} />);
    expect(screen.getByText('\u25CF running')).toBeInTheDocument();
  });

  it('shows branch tag when branch is set', () => {
    render(<RaidRow raid={mockRaid} />);
    expect(screen.getByText('feat/login-form')).toBeInTheDocument();
  });

  it('does not show branch tag when branch is null', () => {
    render(<RaidRow raid={{ ...mockRaid, branch: null }} />);
    expect(screen.queryByText('feat/login-form')).not.toBeInTheDocument();
  });

  it('shows auto-merge label when confidence >= threshold and status is review', () => {
    render(<RaidRow raid={{ ...mockRaid, confidence: 0.96, status: 'review' }} />);
    expect(screen.getByText('auto-merge')).toBeInTheDocument();
  });

  it('does not show auto-merge when confidence is below threshold', () => {
    render(<RaidRow raid={{ ...mockRaid, confidence: 0.5, status: 'review' }} />);
    expect(screen.queryByText('auto-merge')).not.toBeInTheDocument();
  });
});
