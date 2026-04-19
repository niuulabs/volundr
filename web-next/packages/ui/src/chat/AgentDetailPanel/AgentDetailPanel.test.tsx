import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentDetailPanel } from './AgentDetailPanel';
import type { RoomParticipant, AgentInternalEvent } from '../types';

vi.mock('./AgentDetailPanel.module.css', () => ({ default: {} }));
vi.mock('lucide-react', () => ({
  X: () => <span>X</span>,
  ArrowDownIcon: () => null,
}));

function makeParticipant(overrides: Partial<RoomParticipant> = {}): RoomParticipant {
  return {
    peerId: 'peer-1',
    persona: 'Agent Alpha',
    displayName: '',
    color: 'p1',
    participantType: 'ravn',
    status: 'idle',
    joinedAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<AgentInternalEvent> = {}): AgentInternalEvent {
  return {
    id: Math.random().toString(36).slice(2),
    participantId: 'peer-1',
    timestamp: new Date(),
    frameType: 'thought',
    data: 'thinking about this problem',
    metadata: {},
    ...overrides,
  };
}

describe('AgentDetailPanel', () => {
  it('shows participant persona in title', () => {
    const participant = makeParticipant({ persona: 'Agent Alpha' });
    render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
    expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Agent Alpha');
  });

  it('shows participant displayName and persona when displayName is set', () => {
    const participant = makeParticipant({ persona: 'Alpha', displayName: 'Agent One' });
    render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
    expect(screen.getByTestId('agent-persona-name')).toHaveTextContent('Agent One (Alpha)');
  });

  it('shows empty state when no events', () => {
    const participant = makeParticipant();
    render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
    expect(screen.getByTestId('agent-detail-empty')).toBeInTheDocument();
    expect(screen.getByText('Waiting for agent activity…')).toBeInTheDocument();
  });

  it('lists internal events when provided', () => {
    const participant = makeParticipant();
    const events = [
      makeEvent({ frameType: 'thought', data: 'Thinking about X' }),
      makeEvent({ frameType: 'tool_start', data: 'bash', metadata: { tool_name: 'Bash' } }),
    ];
    render(<AgentDetailPanel participant={participant} events={events} onClose={vi.fn()} />);
    expect(screen.getByText('thinking')).toBeInTheDocument();
    expect(screen.getByText('Thinking about X')).toBeInTheDocument();
  });

  it('close button calls onClose', () => {
    const onClose = vi.fn();
    const participant = makeParticipant();
    render(<AgentDetailPanel participant={participant} events={[]} onClose={onClose} />);
    const closeBtn = screen.getByTestId('agent-detail-close');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows participant status badge', () => {
    const participant = makeParticipant({ status: 'thinking' });
    render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
    expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('thinking');
  });

  it('shows "running tool" for tool_executing status', () => {
    const participant = makeParticipant({ status: 'tool_executing' });
    render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
    expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('running tool');
  });

  it('shows "idle" for idle status', () => {
    const participant = makeParticipant({ status: 'idle' });
    render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
    expect(screen.getByTestId('agent-activity-status')).toHaveTextContent('idle');
  });

  it('has data-testid="agent-detail-panel"', () => {
    const participant = makeParticipant();
    render(<AgentDetailPanel participant={participant} events={[]} onClose={vi.fn()} />);
    expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
  });

  it('closes on Escape key press', () => {
    const onClose = vi.fn();
    const participant = makeParticipant();
    render(<AgentDetailPanel participant={participant} events={[]} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders tool_result events', () => {
    const participant = makeParticipant();
    const events = [
      makeEvent({
        frameType: 'tool_result',
        data: 'result output',
        metadata: { tool_name: 'Bash' },
      }),
    ];
    render(<AgentDetailPanel participant={participant} events={events} onClose={vi.fn()} />);
    expect(screen.getByText('result: Bash')).toBeInTheDocument();
    expect(screen.getByText('result output')).toBeInTheDocument();
  });
});
