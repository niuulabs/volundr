import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionCard } from './SessionCard';
import type { SessionInfo } from '../../models';

const mockSession: SessionInfo = {
  session_id: 'sess-abc-123',
  status: 'running',
  chronicle_lines: ['Cloning repository...', 'Installing dependencies...', 'Running tests...'],
  branch: 'feat/test-branch',
  confidence: 0.75,
  raid_name: 'Add test infrastructure',
  saga_name: 'Test Saga',
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

  it('renders raid name and saga name', () => {
    render(<SessionCard session={mockSession} />);
    expect(screen.getByText('Add test infrastructure')).toBeInTheDocument();
    expect(screen.getByText('Test Saga')).toBeInTheDocument();
  });

  it('renders branch tag when branch is present', () => {
    render(<SessionCard session={mockSession} />);
    expect(screen.getByText('feat/test-branch')).toBeInTheDocument();
  });

  it('does not render branch tag when branch is null', () => {
    render(<SessionCard session={{ ...mockSession, branch: null }} />);
    expect(screen.queryByText('feat/test-branch')).not.toBeInTheDocument();
  });

  it('renders confidence badge', () => {
    render(<SessionCard session={mockSession} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('renders review button for review status when onReview is provided', () => {
    const onReview = vi.fn();
    const reviewSession = { ...mockSession, status: 'review' };
    render(<SessionCard session={reviewSession} onReview={onReview} onApprove={vi.fn()} />);
    const btn = screen.getByText('Review');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onReview).toHaveBeenCalledWith('sess-abc-123');
  });

  it('does not render review button for non-review status', () => {
    render(<SessionCard session={mockSession} onReview={vi.fn()} />);
    expect(screen.queryByText('Review')).not.toBeInTheDocument();
  });
});
