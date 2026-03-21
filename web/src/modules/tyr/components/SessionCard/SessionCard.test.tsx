import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionCard } from './SessionCard';
import type { SessionInfo } from '../../models';

const mockSession: SessionInfo = {
  session_id: 'sess-abc-123',
  status: 'running',
  chronicle_lines: ['Cloning repository...', 'Installing dependencies...', 'Running tests...'],
};

describe('SessionCard', () => {
  it('renders session id', () => {
    render(<SessionCard session={mockSession} />);
    expect(screen.getByText('sess-abc-123')).toBeInTheDocument();
  });

  it('shows chronicle lines', () => {
    render(<SessionCard session={mockSession} />);
    expect(screen.getByText('Cloning repository...')).toBeInTheDocument();
    expect(screen.getByText('Installing dependencies...')).toBeInTheDocument();
    expect(screen.getByText('Running tests...')).toBeInTheDocument();
  });

  it('shows empty message when no chronicle lines', () => {
    render(<SessionCard session={{ ...mockSession, chronicle_lines: [] }} />);
    expect(screen.getByText('No chronicle output')).toBeInTheDocument();
  });

  it('renders approve button when onApprove is provided', () => {
    const onApprove = vi.fn();
    render(<SessionCard session={mockSession} onApprove={onApprove} />);
    const btn = screen.getByText('Approve');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onApprove).toHaveBeenCalledWith('sess-abc-123');
  });

  it('does not render approve button when onApprove is not provided', () => {
    render(<SessionCard session={mockSession} />);
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
  });

  it('renders session status badge', () => {
    render(<SessionCard session={mockSession} />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });
});
