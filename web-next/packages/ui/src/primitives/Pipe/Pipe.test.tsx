import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pipe } from './Pipe';
import type { PipePhase, PipePhaseStatus } from './Pipe';

describe('Pipe', () => {
  it('renders one cell per phase', () => {
    const phases: PipePhase[] = [
      { status: 'done' },
      { status: 'running' },
      { status: 'pending' },
    ];
    const { container } = render(<Pipe phases={phases} />);
    const cells = container.querySelectorAll('.niuu-pipe__cell');
    expect(cells).toHaveLength(3);
  });

  it('renders empty pipe with no phases', () => {
    const { container } = render(<Pipe phases={[]} />);
    expect(container.querySelectorAll('.niuu-pipe__cell')).toHaveLength(0);
  });

  it('applies done class for done phase', () => {
    const { container } = render(<Pipe phases={[{ status: 'done' }]} />);
    expect(container.querySelector('.niuu-pipe__cell--done')).not.toBeNull();
  });

  it('applies running class for running phase', () => {
    const { container } = render(<Pipe phases={[{ status: 'running' }]} />);
    expect(container.querySelector('.niuu-pipe__cell--running')).not.toBeNull();
  });

  it('applies pending class for pending phase', () => {
    const { container } = render(<Pipe phases={[{ status: 'pending' }]} />);
    expect(container.querySelector('.niuu-pipe__cell--pending')).not.toBeNull();
  });

  it('applies failed class for failed phase', () => {
    const { container } = render(<Pipe phases={[{ status: 'failed' }]} />);
    expect(container.querySelector('.niuu-pipe__cell--failed')).not.toBeNull();
  });

  it('applies skipped class for skipped phase', () => {
    const { container } = render(<Pipe phases={[{ status: 'skipped' }]} />);
    expect(container.querySelector('.niuu-pipe__cell--skipped')).not.toBeNull();
  });

  it('applies all status variants correctly', () => {
    const statuses: PipePhaseStatus[] = ['pending', 'running', 'done', 'failed', 'skipped'];
    const phases: PipePhase[] = statuses.map((s) => ({ status: s }));
    const { container } = render(<Pipe phases={phases} />);
    for (const status of statuses) {
      expect(container.querySelector(`.niuu-pipe__cell--${status}`)).not.toBeNull();
    }
  });

  it('uses phase label as title when provided', () => {
    const { container } = render(<Pipe phases={[{ status: 'done', label: 'build' }]} />);
    expect(container.querySelector('.niuu-pipe__cell')?.getAttribute('title')).toBe('build');
  });

  it('uses status as title when no label provided', () => {
    const { container } = render(<Pipe phases={[{ status: 'failed' }]} />);
    expect(container.querySelector('.niuu-pipe__cell')?.getAttribute('title')).toBe('failed');
  });

  it('has accessible aria-label on the container', () => {
    render(<Pipe phases={[{ status: 'done' }]} />);
    expect(screen.getByLabelText('phase progress')).toBeInTheDocument();
  });

  it('passes className through', () => {
    const { container } = render(<Pipe phases={[]} className="my-pipe" />);
    expect(container.querySelector('.my-pipe')).not.toBeNull();
  });
});
