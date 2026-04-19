import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventLog } from './EventLog';
import type { ObservatoryEvent } from '../../domain';

const EVENTS: ObservatoryEvent[] = [
  {
    id: 'ev-1',
    timestamp: '2026-04-19T00:00:01Z',
    severity: 'info',
    sourceId: 'tyr-0',
    message: 'raid-omega formed',
  },
  {
    id: 'ev-2',
    timestamp: '2026-04-19T00:00:05Z',
    severity: 'warn',
    sourceId: 'mimir-0',
    message: 'write queue depth nearing threshold',
  },
  {
    id: 'ev-3',
    timestamp: '2026-04-19T00:00:10Z',
    severity: 'error',
    sourceId: 'bifrost-0',
    message: 'inference timeout',
  },
  {
    id: 'ev-4',
    timestamp: '2026-04-19T00:00:15Z',
    severity: 'debug',
    sourceId: 'ravn-huginn',
    message: 'cache hit 94%',
  },
];

describe('EventLog', () => {
  it('renders empty state message when no events', () => {
    render(<EventLog events={[]} />);
    expect(screen.getByText('no events')).toBeInTheDocument();
  });

  it('renders all event messages', () => {
    render(<EventLog events={EVENTS} />);
    expect(screen.getByText('raid-omega formed')).toBeInTheDocument();
    expect(screen.getByText('inference timeout')).toBeInTheDocument();
  });

  it('renders all event source IDs', () => {
    render(<EventLog events={EVENTS} />);
    expect(screen.getByText('tyr-0')).toBeInTheDocument();
    expect(screen.getByText('mimir-0')).toBeInTheDocument();
  });

  it('renders truncated timestamps (HH:MM:SS)', () => {
    render(<EventLog events={EVENTS} />);
    expect(screen.getByText('00:00:01')).toBeInTheDocument();
  });

  it('renders severity tags', () => {
    render(<EventLog events={EVENTS} />);
    expect(screen.getByText('INF')).toBeInTheDocument();
    expect(screen.getByText('WRN')).toBeInTheDocument();
    expect(screen.getByText('ERR')).toBeInTheDocument();
    expect(screen.getByText('DBG')).toBeInTheDocument();
  });

  it('sets data-severity attribute on each entry', () => {
    render(<EventLog events={EVENTS} />);
    const infoEntry = screen.getByTestId('event-ev-1');
    expect(infoEntry).toHaveAttribute('data-severity', 'info');
    const warnEntry = screen.getByTestId('event-ev-2');
    expect(warnEntry).toHaveAttribute('data-severity', 'warn');
  });

  it('accepts custom data-testid', () => {
    render(<EventLog events={[]} data-testid="my-log" />);
    expect(screen.getByTestId('my-log')).toBeInTheDocument();
  });

  it('renders event entries in order', () => {
    render(<EventLog events={EVENTS} />);
    const entries = screen.getAllByTestId(/^event-ev/);
    expect(entries[0]).toHaveAttribute('data-testid', 'event-ev-1');
    expect(entries[3]).toHaveAttribute('data-testid', 'event-ev-4');
  });

  it('does not render "no events" when events are present', () => {
    render(<EventLog events={EVENTS} />);
    expect(screen.queryByText('no events')).toBeNull();
  });
});
