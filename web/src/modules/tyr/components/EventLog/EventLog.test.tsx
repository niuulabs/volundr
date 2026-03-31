import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventLog } from './EventLog';
import type { SseEvent, ActiveRaid } from '../../hooks';

const mockEvent: SseEvent = {
  id: '1',
  type: 'raid.state_changed',
  data: JSON.stringify({ tracker_id: 'tr-1', status: 'review', identifier: 'NIU-100' }),
  receivedAt: new Date('2026-03-27T10:00:00Z'),
};

const mockRaid: ActiveRaid = {
  tracker_id: 'tr-1',
  identifier: 'NIU-100',
  title: 'Fix bug',
  url: '',
  status: 'running' as ActiveRaid['status'],
  session_id: null,
  confidence: 0.5,
  pr_url: null,
  last_updated: '2026-03-27T00:00:00Z',
};

describe('EventLog', () => {
  it('should render empty state', () => {
    render(<EventLog events={[]} />);
    expect(screen.getByText('Waiting for events...')).toBeDefined();
  });

  it('should render events with tags', () => {
    render(<EventLog events={[mockEvent]} raids={[mockRaid]} />);
    expect(screen.getByText('state')).toBeDefined();
  });

  it('should render confidence events', () => {
    const confEvent: SseEvent = {
      id: '2',
      type: 'confidence.updated',
      data: JSON.stringify({ confidence: 0.85 }),
      receivedAt: new Date(),
    };
    render(<EventLog events={[confEvent]} />);
    expect(screen.getByText('conf')).toBeDefined();
  });

  it('should render phase events', () => {
    const ev: SseEvent = { id: '3', type: 'phase.unlocked', data: '{}', receivedAt: new Date() };
    render(<EventLog events={[ev]} />);
    expect(screen.getByText('phase')).toBeDefined();
  });

  it('should render dispatch events', () => {
    const ev: SseEvent = { id: '4', type: 'dispatch.started', data: '{}', receivedAt: new Date() };
    render(<EventLog events={[ev]} />);
    expect(screen.getByText('dispatch')).toBeDefined();
  });

  it('should render session events', () => {
    const ev: SseEvent = {
      id: '5',
      type: 'session.state_changed',
      data: JSON.stringify({ session_id: 'abc12345-xyz', state: 'idle' }),
      receivedAt: new Date(),
    };
    render(<EventLog events={[ev]} />);
    expect(screen.getByText('session')).toBeDefined();
  });

  it('should render review events', () => {
    const ev: SseEvent = { id: '6', type: 'review.completed', data: '{}', receivedAt: new Date() };
    render(<EventLog events={[ev]} />);
    expect(screen.getByText('review')).toBeDefined();
  });

  it('should handle non-JSON data gracefully', () => {
    const ev: SseEvent = {
      id: '7',
      type: 'unknown.type',
      data: 'plain text',
      receivedAt: new Date(),
    };
    render(<EventLog events={[ev]} />);
    expect(screen.getByText('plain text')).toBeDefined();
  });
});
