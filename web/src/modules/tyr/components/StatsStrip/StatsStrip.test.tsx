import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatsStrip } from './StatsStrip';

describe('StatsStrip', () => {
  const summary = {
    running: 3,
    review: 1,
    merged: 5,
    failed: 0,
    queued: 2,
    pending: 1,
    escalated: 0,
  };

  it('should render all status counts', () => {
    render(
      <StatsStrip
        summary={summary}
        activeFilter={null}
        onStatusClick={vi.fn()}
        showCompleted={false}
        onToggleCompleted={vi.fn()}
      />
    );
    expect(screen.getByText('Running')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('Review')).toBeDefined();
  });

  it('should call onStatusClick when a status is clicked', () => {
    const onClick = vi.fn();
    render(
      <StatsStrip
        summary={summary}
        activeFilter={null}
        onStatusClick={onClick}
        showCompleted={false}
        onToggleCompleted={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('Running'));
    expect(onClick).toHaveBeenCalledWith('running');
  });

  it('should call onToggleCompleted', () => {
    const onToggle = vi.fn();
    render(
      <StatsStrip
        summary={summary}
        activeFilter={null}
        onStatusClick={vi.fn()}
        showCompleted={false}
        onToggleCompleted={onToggle}
      />
    );
    fireEvent.click(screen.getByText('Show all'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('should show "Hide done" when showCompleted is true', () => {
    render(
      <StatsStrip
        summary={summary}
        activeFilter={null}
        onStatusClick={vi.fn()}
        showCompleted={true}
        onToggleCompleted={vi.fn()}
      />
    );
    expect(screen.getByText('Hide done')).toBeDefined();
  });
});
