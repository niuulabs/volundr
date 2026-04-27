import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionChat } from './SessionChat';
import type { AgentInternalEvent, ChatMessage, RoomParticipant } from '../../types';

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

const participant: RoomParticipant = {
  peerId: 'peer-1',
  persona: 'Ravn-A',
  displayName: 'Reviewer',
  color: 'amber',
  participantType: 'ravn',
  status: 'thinking',
};

const messages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'assistant',
    content: 'Need to inspect the config first.',
    createdAt: new Date('2026-04-26T12:00:00Z'),
    status: 'done',
    participant,
  },
];

const agentEvents = new Map<string, AgentInternalEvent[]>([
  [
    'peer-1',
    [
      {
        id: 'evt-1',
        participantId: 'peer-1',
        timestamp: new Date('2026-04-26T12:00:01Z'),
        frameType: 'thought',
        data: 'Checking compose and runtime settings.',
      },
    ],
  ],
]);

describe('SessionChat', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the agent detail panel from a room message', () => {
    render(
      <SessionChat
        messages={messages}
        connected
        historyLoaded
        participants={new Map([[participant.peerId, participant]])}
        agentEvents={agentEvents}
        onSend={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText('View event stream for Ravn-A'));

    expect(screen.getByTestId('agent-detail-panel')).toBeInTheDocument();
    expect(screen.getByText('Checking compose and runtime settings.')).toBeInTheDocument();
  });
});
