import React from 'react';
import { render, screen } from '@testing-library/react';
import { MeshEventCard } from './MeshEventCard';
import type { MeshOutcomeEvent, MeshDelegationEvent, MeshNotificationEvent, ParticipantMeta } from '../types';

vi.mock('./MeshEventCard.module.css', () => ({ default: {} }));
vi.mock('lucide-react', () => ({
  CheckCircle: () => <span data-testid="check-circle" />,
  XCircle: () => <span data-testid="x-circle" />,
  AlertTriangle: () => <span data-testid="alert-triangle" />,
  ArrowRight: () => <span data-testid="arrow-right" />,
  HelpCircle: () => <span data-testid="help-circle" />,
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

describe('MeshEventCard', () => {
  describe('outcome event', () => {
    const outcomeEvent: MeshOutcomeEvent = {
      type: 'outcome',
      id: 'evt-1',
      timestamp: new Date('2024-01-01T12:00:00Z'),
      participantId: 'peer-1',
      participant: makeParticipant(),
      persona: 'Agent Alpha',
      eventType: 'review_complete',
      fields: {},
      valid: true,
      verdict: 'pass',
      summary: 'All checks passed',
    };

    it('renders outcome event with persona', () => {
      render(<MeshEventCard event={outcomeEvent} />);
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    });

    it('renders the eventType', () => {
      render(<MeshEventCard event={outcomeEvent} />);
      expect(screen.getByText('review_complete')).toBeInTheDocument();
    });

    it('renders verdict text "Passed" for pass verdict', () => {
      render(<MeshEventCard event={outcomeEvent} />);
      expect(screen.getByText('Passed')).toBeInTheDocument();
    });

    it('renders summary text', () => {
      render(<MeshEventCard event={outcomeEvent} />);
      expect(screen.getByText('All checks passed')).toBeInTheDocument();
    });

    it('renders verdict div with correct data-verdict attribute', () => {
      render(<MeshEventCard event={outcomeEvent} />);
      const verdictEl = document.querySelector('[data-verdict="pass"]');
      expect(verdictEl).toBeInTheDocument();
    });

    it('renders "Failed" text for fail verdict', () => {
      const failEvent = { ...outcomeEvent, verdict: 'fail' };
      render(<MeshEventCard event={failEvent} />);
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });
  });

  describe('mesh_message (delegation) event', () => {
    const delegationEvent: MeshDelegationEvent = {
      type: 'mesh_message',
      id: 'evt-2',
      timestamp: new Date('2024-01-01T12:01:00Z'),
      participantId: 'peer-1',
      participant: makeParticipant(),
      fromPersona: 'Alpha Delegate',
      eventType: 'delegate_task',
      direction: 'delegate',
      preview: 'Please review the implementation',
    };

    it('renders fromPersona', () => {
      render(<MeshEventCard event={delegationEvent} />);
      expect(screen.getByText('Alpha Delegate')).toBeInTheDocument();
    });

    it('renders eventType', () => {
      render(<MeshEventCard event={delegationEvent} />);
      expect(screen.getByText('delegate_task')).toBeInTheDocument();
    });

    it('renders preview text', () => {
      render(<MeshEventCard event={delegationEvent} />);
      expect(screen.getByText('Please review the implementation')).toBeInTheDocument();
    });

    it('renders arrow icon', () => {
      render(<MeshEventCard event={delegationEvent} />);
      expect(screen.getByTestId('arrow-right')).toBeInTheDocument();
    });
  });

  describe('notification event', () => {
    const notificationEvent: MeshNotificationEvent = {
      type: 'notification',
      id: 'evt-3',
      timestamp: new Date('2024-01-01T12:02:00Z'),
      participantId: 'peer-1',
      participant: makeParticipant(),
      notificationType: 'escalation',
      persona: 'Agent Alpha',
      reason: 'needs_input',
      summary: 'Awaiting user decision',
      urgency: 0.8,
    };

    it('renders notification persona', () => {
      render(<MeshEventCard event={notificationEvent} />);
      expect(screen.getByText('Agent Alpha')).toBeInTheDocument();
    });

    it('renders summary', () => {
      render(<MeshEventCard event={notificationEvent} />);
      expect(screen.getByText('Awaiting user decision')).toBeInTheDocument();
    });

    it('renders reason', () => {
      render(<MeshEventCard event={notificationEvent} />);
      expect(screen.getByText('Reason: needs_input')).toBeInTheDocument();
    });

    it('renders notification type', () => {
      render(<MeshEventCard event={notificationEvent} />);
      expect(screen.getByText('escalation')).toBeInTheDocument();
    });

    it('renders recommendation when provided', () => {
      const eventWithRec = { ...notificationEvent, recommendation: 'Please approve or reject' };
      render(<MeshEventCard event={eventWithRec} />);
      expect(screen.getByText('Please approve or reject')).toBeInTheDocument();
    });
  });
});
