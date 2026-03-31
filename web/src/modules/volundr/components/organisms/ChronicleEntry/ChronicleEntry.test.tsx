import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChronicleEntry as ChronicleEntryModel } from '@/modules/volundr/models';
import { ChronicleEntry } from './ChronicleEntry';

describe('ChronicleEntry', () => {
  const baseEntry: ChronicleEntryModel = {
    time: '10:47',
    type: 'think',
    agent: 'Odin',
    message: 'Analyzing memory pressure in Midgard',
  };

  it('renders time', () => {
    render(<ChronicleEntry entry={baseEntry} />);
    expect(screen.getByText('10:47')).toBeInTheDocument();
  });

  it('renders agent name', () => {
    render(<ChronicleEntry entry={baseEntry} />);
    expect(screen.getByText('Odin')).toBeInTheDocument();
  });

  it('renders message', () => {
    render(<ChronicleEntry entry={baseEntry} />);
    expect(screen.getByText('Analyzing memory pressure in Midgard')).toBeInTheDocument();
  });

  it('renders entry type badge', () => {
    render(<ChronicleEntry entry={baseEntry} />);
    expect(screen.getByText('think')).toBeInTheDocument();
  });

  it('renders details when provided', () => {
    const entryWithDetails: ChronicleEntryModel = {
      ...baseEntry,
      details: 'Additional context here',
    };
    render(<ChronicleEntry entry={entryWithDetails} />);
    expect(screen.getByText('Additional context here')).toBeInTheDocument();
  });

  it('does not render details when not provided', () => {
    const { container } = render(<ChronicleEntry entry={baseEntry} />);
    const detailsElement = container.querySelector('[class*="details"]');
    expect(detailsElement).not.toBeInTheDocument();
  });

  it('renders action zone when provided', () => {
    const entryWithZone: ChronicleEntryModel = {
      ...baseEntry,
      zone: 'yellow',
    };
    render(<ChronicleEntry entry={entryWithZone} />);
    expect(screen.getByText('yellow')).toBeInTheDocument();
  });

  it('does not render zone when not provided', () => {
    render(<ChronicleEntry entry={baseEntry} />);
    expect(screen.queryByText('green')).not.toBeInTheDocument();
    expect(screen.queryByText('yellow')).not.toBeInTheDocument();
    expect(screen.queryByText('red')).not.toBeInTheDocument();
  });

  it('renders observe type entry', () => {
    const observeEntry: ChronicleEntryModel = {
      time: '10:46',
      type: 'observe',
      agent: 'Sigrun',
      message: 'analytics-worker memory at 85%',
      severity: 'warning',
    };
    render(<ChronicleEntry entry={observeEntry} />);
    expect(screen.getByText('observe')).toBeInTheDocument();
    expect(screen.getByText('Sigrun')).toBeInTheDocument();
  });

  it('renders act type entry', () => {
    const actEntry: ChronicleEntryModel = {
      time: '10:40',
      type: 'act',
      agent: 'Tyr',
      message: 'Assigned ein-valhalla-003 to campaign',
    };
    render(<ChronicleEntry entry={actEntry} />);
    expect(screen.getByText('act')).toBeInTheDocument();
  });

  it('renders decide type entry', () => {
    const decideEntry: ChronicleEntryModel = {
      time: '10:45',
      type: 'decide',
      agent: 'Odin',
      message: 'Queuing config change for analytics',
      zone: 'yellow',
    };
    render(<ChronicleEntry entry={decideEntry} />);
    expect(screen.getByText('decide')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<ChronicleEntry entry={baseEntry} className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders all entry types', () => {
    const types = [
      'think',
      'observe',
      'decide',
      'act',
      'complete',
      'merge',
      'sense',
      'checkpoint',
      'mimic',
    ] as const;

    for (const type of types) {
      const entry: ChronicleEntryModel = {
        ...baseEntry,
        type,
      };
      const { unmount } = render(<ChronicleEntry entry={entry} />);
      expect(screen.getByText(type)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders all zone types', () => {
    const zones = ['green', 'yellow', 'red'] as const;

    for (const zone of zones) {
      const entry: ChronicleEntryModel = {
        ...baseEntry,
        zone,
      };
      const { unmount } = render(<ChronicleEntry entry={entry} />);
      expect(screen.getByText(zone)).toBeInTheDocument();
      unmount();
    }
  });
});
