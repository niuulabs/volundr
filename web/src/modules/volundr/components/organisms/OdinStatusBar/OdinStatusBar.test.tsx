import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { OdinState } from '@/modules/volundr/models';
import { OdinStatusBar } from './OdinStatusBar';

describe('OdinStatusBar', () => {
  const baseState: OdinState = {
    status: 'thinking',
    loopCycle: 847291,
    loopPhase: 'THINK',
    loopProgress: 65,
    currentThought: 'Analyzing storage migration patterns',
    attention: {
      primary: 'Storage migration',
      secondary: ['Database health', 'API performance'],
    },
    disposition: { alertness: 0.7, concern: 0.3, creativity: 0.5 },
    circadianMode: 'active',
    resources: { idleGPUs: 4, totalGPUs: 8, availableCapacity: 35 },
    stats: {
      realmsHealthy: 4,
      realmsTotal: 5,
      activeCampaigns: 2,
      einherjarWorking: 5,
      einherjarTotal: 7,
      observationsToday: 1247,
      decisionsToday: 89,
      actionsToday: 34,
    },
    pendingDecisions: [],
  };

  const stateWithDecisions: OdinState = {
    ...baseState,
    pendingDecisions: [
      {
        id: 'dec-1',
        type: 'merge',
        description: 'Merge PR #47 in storage-service',
        confidence: 0.82,
        threshold: 0.85,
        zone: 'yellow',
      },
      {
        id: 'dec-2',
        type: 'deploy',
        description: 'Deploy API v2.1 to production',
        confidence: 0.91,
        threshold: 0.9,
        zone: 'green',
      },
    ],
  };

  describe('Full variant (default)', () => {
    it('renders Odin name', () => {
      render(<OdinStatusBar state={baseState} />);
      expect(screen.getByText('Odin')).toBeInTheDocument();
    });

    it('renders current thought', () => {
      render(<OdinStatusBar state={baseState} />);
      expect(screen.getByText('Analyzing storage migration patterns')).toBeInTheDocument();
    });

    it('renders status badge', () => {
      render(<OdinStatusBar state={baseState} />);
      expect(screen.getByText('thinking')).toBeInTheDocument();
    });

    it('renders cycle number', () => {
      render(<OdinStatusBar state={baseState} />);
      expect(screen.getByText('cycle #847291')).toBeInTheDocument();
    });

    it('renders primary attention focus', () => {
      render(<OdinStatusBar state={baseState} />);
      expect(screen.getByText('Storage migration')).toBeInTheDocument();
    });

    it('renders secondary attention', () => {
      render(<OdinStatusBar state={baseState} />);
      expect(screen.getByText('Database health, API performance')).toBeInTheDocument();
    });

    it('renders GPU resources', () => {
      render(<OdinStatusBar state={baseState} />);
      expect(screen.getByText('4/8 idle')).toBeInTheDocument();
    });

    it('renders capacity', () => {
      render(<OdinStatusBar state={baseState} />);
      expect(screen.getByText('35% free')).toBeInTheDocument();
    });

    it('does not render decisions section when no pending decisions', () => {
      render(<OdinStatusBar state={baseState} />);
      expect(screen.queryByText(/Pending Decisions/)).not.toBeInTheDocument();
    });

    it('renders decisions section when there are pending decisions', () => {
      render(<OdinStatusBar state={stateWithDecisions} />);
      expect(screen.getByText('Pending Decisions (2)')).toBeInTheDocument();
    });

    it('renders decision descriptions', () => {
      render(<OdinStatusBar state={stateWithDecisions} />);
      expect(screen.getByText('Merge PR #47 in storage-service')).toBeInTheDocument();
      expect(screen.getByText('Deploy API v2.1 to production')).toBeInTheDocument();
    });

    it('renders decision confidence', () => {
      render(<OdinStatusBar state={stateWithDecisions} />);
      expect(screen.getByText(/Confidence: 82%/)).toBeInTheDocument();
      expect(screen.getByText(/need 85%/)).toBeInTheDocument();
    });

    it('renders approve buttons', () => {
      render(<OdinStatusBar state={stateWithDecisions} />);
      const approveButtons = screen.getAllByText('Approve');
      expect(approveButtons).toHaveLength(2);
    });

    it('renders deny buttons', () => {
      render(<OdinStatusBar state={stateWithDecisions} />);
      const denyButtons = screen.getAllByText('Deny');
      expect(denyButtons).toHaveLength(2);
    });

    it('calls onApproveDecision when approve button clicked', () => {
      const handleApprove = vi.fn();
      render(<OdinStatusBar state={stateWithDecisions} onApproveDecision={handleApprove} />);

      const approveButtons = screen.getAllByText('Approve');
      fireEvent.click(approveButtons[0]);

      expect(handleApprove).toHaveBeenCalledWith('dec-1');
    });

    it('calls onDenyDecision when deny button clicked', () => {
      const handleDeny = vi.fn();
      render(<OdinStatusBar state={stateWithDecisions} onDenyDecision={handleDeny} />);

      const denyButtons = screen.getAllByText('Deny');
      fireEvent.click(denyButtons[1]);

      expect(handleDeny).toHaveBeenCalledWith('dec-2');
    });

    it('applies custom className', () => {
      const { container } = render(<OdinStatusBar state={baseState} className="custom-class" />);
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('Compact variant', () => {
    it('renders compact variant when compact prop is true', () => {
      const { container } = render(<OdinStatusBar state={baseState} compact />);
      const element = container.firstChild as HTMLElement;
      expect(element.className).toMatch(/compact/);
    });

    it('renders Odin name in compact mode', () => {
      render(<OdinStatusBar state={baseState} compact />);
      expect(screen.getByText('Odin')).toBeInTheDocument();
    });

    it('renders current thought in compact mode', () => {
      render(<OdinStatusBar state={baseState} compact />);
      expect(screen.getByText('Analyzing storage migration patterns')).toBeInTheDocument();
    });

    it('does not render full resource info in compact mode', () => {
      render(<OdinStatusBar state={baseState} compact />);
      expect(screen.queryByText('4/8 idle')).not.toBeInTheDocument();
    });

    it('does not render cycle in compact mode', () => {
      render(<OdinStatusBar state={baseState} compact />);
      expect(screen.queryByText('cycle #847291')).not.toBeInTheDocument();
    });

    it('shows pending badge when decisions exist in compact mode', () => {
      render(<OdinStatusBar state={stateWithDecisions} compact />);
      expect(screen.getByText('2 pending')).toBeInTheDocument();
    });

    it('does not show pending badge when no decisions in compact mode', () => {
      render(<OdinStatusBar state={baseState} compact />);
      expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
    });
  });

  describe('Different states', () => {
    it('renders sensing status', () => {
      const sensingState = {
        ...baseState,
        status: 'sensing' as const,
        loopPhase: 'SENSE' as const,
      };
      render(<OdinStatusBar state={sensingState} />);
      expect(screen.getByText('sensing')).toBeInTheDocument();
    });

    it('renders deciding status', () => {
      const decidingState = {
        ...baseState,
        status: 'deciding' as const,
        loopPhase: 'DECIDE' as const,
      };
      render(<OdinStatusBar state={decidingState} />);
      expect(screen.getByText('deciding')).toBeInTheDocument();
    });

    it('renders acting status', () => {
      const actingState = { ...baseState, status: 'acting' as const, loopPhase: 'ACT' as const };
      render(<OdinStatusBar state={actingState} />);
      expect(screen.getByText('acting')).toBeInTheDocument();
    });

    it('renders morning circadian mode', () => {
      const morningState = { ...baseState, circadianMode: 'morning' as const };
      render(<OdinStatusBar state={morningState} />);
      // CircadianIcon component should render with mode
      expect(screen.getByText('Odin')).toBeInTheDocument();
    });

    it('renders night circadian mode', () => {
      const nightState = { ...baseState, circadianMode: 'night' as const };
      render(<OdinStatusBar state={nightState} />);
      expect(screen.getByText('Odin')).toBeInTheDocument();
    });
  });
});
