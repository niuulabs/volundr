import React from 'react';
import { render, screen } from '@testing-library/react';
import { MeshCascadePanel } from './MeshCascadePanel';
import type { MeshEvent, ParticipantMeta } from '../types';

vi.mock('./MeshCascadePanel.module.css', () => ({ default: {} }));
vi.mock('../MeshEventCard/MeshEventCard', () => ({
  MeshEventCard: ({ event }: { event: { type: string } }) => (
    <div data-testid="mesh-event">{event.type}</div>
  ),
}));
vi.mock('lucide-react', () => ({
  Workflow: () => null,
}));

function makeParticipant(overrides: Partial<ParticipantMeta> = {}): ParticipantMeta {
  return {
    peerId: 'peer-1',
    persona: 'Agent Alpha',
    displayName: 'Alpha',
    color: 'p1',
    participantType: 'ravn',
    ...overrides,
  };
}

const outcomeEvent: MeshEvent = {
  type: 'outcome',
  id: 'evt-1',
  timestamp: new Date(),
  participantId: 'peer-1',
  participant: makeParticipant(),
  persona: 'Alpha',
  eventType: 'review',
  fields: {},
  valid: true,
  verdict: 'pass',
};

const meshMessageEvent: MeshEvent = {
  type: 'mesh_message',
  id: 'evt-2',
  timestamp: new Date(),
  participantId: 'peer-1',
  participant: makeParticipant(),
  fromPersona: 'Alpha',
  eventType: 'delegate',
  direction: 'delegate',
  preview: 'Task preview',
};

const notificationEvent: MeshEvent = {
  type: 'notification',
  id: 'evt-3',
  timestamp: new Date(),
  participantId: 'peer-1',
  participant: makeParticipant(),
  notificationType: 'alert',
  persona: 'Alpha',
  reason: 'blocker',
  summary: 'Alert summary',
  urgency: 0.9,
};

describe('MeshCascadePanel', () => {
  it('renders null when events list is empty', () => {
    const { container } = render(<MeshCascadePanel events={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows events in order', () => {
    const events = [outcomeEvent, meshMessageEvent, notificationEvent];
    render(<MeshCascadePanel events={events} />);
    const renderedEvents = screen.getAllByTestId('mesh-event');
    expect(renderedEvents).toHaveLength(3);
    expect(renderedEvents[0]).toHaveTextContent('outcome');
    expect(renderedEvents[1]).toHaveTextContent('mesh_message');
    expect(renderedEvents[2]).toHaveTextContent('notification');
  });

  it('shows total event count badge', () => {
    render(<MeshCascadePanel events={[outcomeEvent, meshMessageEvent]} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows "Mesh Cascade" title', () => {
    render(<MeshCascadePanel events={[outcomeEvent]} />);
    expect(screen.getByText('Mesh Cascade')).toBeInTheDocument();
  });

  it('shows outcomes count in summary', () => {
    render(<MeshCascadePanel events={[outcomeEvent, outcomeEvent]} />);
    expect(screen.getByText('2 outcomes')).toBeInTheDocument();
  });

  it('shows delegations count in summary', () => {
    render(<MeshCascadePanel events={[meshMessageEvent]} />);
    expect(screen.getByText('1 delegation')).toBeInTheDocument();
  });

  it('shows notifications/alerts count in summary', () => {
    render(<MeshCascadePanel events={[notificationEvent]} />);
    expect(screen.getByText('1 alert')).toBeInTheDocument();
  });
});
