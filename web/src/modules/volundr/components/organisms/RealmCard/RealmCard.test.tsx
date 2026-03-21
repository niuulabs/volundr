import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Realm } from '@/modules/volundr/models';
import { RealmCard } from './RealmCard';

describe('RealmCard', () => {
  const healthyRealm: Realm = {
    id: 'valhalla',
    name: 'Valhalla',
    description: 'AI/ML GPU cluster',
    location: 'ca-hamilton-1',
    status: 'healthy',
    health: {
      status: 'healthy',
      inputs: {
        nodesReady: 3,
        nodesTotal: 3,
        podRunningRatio: 1.0,
        volumesDegraded: 0,
        volumesFaulted: 0,
        recentErrorCount: 0,
      },
      reason: '',
    },
    resources: {
      cpu: { capacity: 48, allocatable: 44, unit: 'cores' },
      memory: { capacity: 384, allocatable: 360, unit: 'GiB' },
      gpuCount: 6,
      pods: { running: 14, pending: 1, failed: 0, succeeded: 3, unknown: 0 },
    },
    valkyrie: {
      name: 'Sigrdrifa',
      status: 'observing',
      uptime: '14d 07:23:41',
      observationsToday: 412,
      specialty: 'AI/ML workloads',
    },
  };

  const warningRealm: Realm = {
    id: 'glitnir',
    name: 'Glitnir',
    description: 'Observability',
    location: 'ca-hamilton-2',
    status: 'warning',
    health: {
      status: 'warning',
      inputs: {
        nodesReady: 2,
        nodesTotal: 2,
        podRunningRatio: 0.92,
        volumesDegraded: 1,
        volumesFaulted: 0,
        recentErrorCount: 3,
      },
      reason: '1 volume degraded',
    },
    resources: {
      cpu: { capacity: 16, allocatable: 14, unit: 'cores' },
      memory: { capacity: 64, allocatable: 58, unit: 'GiB' },
      gpuCount: 0,
      pods: { running: 18, pending: 0, failed: 1, succeeded: 5, unknown: 0 },
    },
    valkyrie: {
      name: 'Mist',
      status: 'observing',
      uptime: '10d 01:15:00',
      observationsToday: 289,
      specialty: 'Observability & metrics',
    },
  };

  const offlineRealm: Realm = {
    id: 'ymir',
    name: 'Ymir',
    description: 'Bootstrap cluster',
    location: 'ca-hamilton-1',
    status: 'offline',
    health: {
      status: 'offline',
      inputs: {
        nodesReady: 0,
        nodesTotal: 1,
        podRunningRatio: 0,
        volumesDegraded: 0,
        volumesFaulted: 0,
        recentErrorCount: 0,
      },
      reason: 'No nodes ready',
    },
    resources: {
      cpu: { capacity: 8, allocatable: 0, unit: 'cores' },
      memory: { capacity: 32, allocatable: 0, unit: 'GiB' },
      gpuCount: 0,
      pods: { running: 0, pending: 0, failed: 0, succeeded: 0, unknown: 0 },
    },
    valkyrie: null,
  };

  const realmNoGpus: Realm = {
    ...healthyRealm,
    id: 'asgard',
    name: 'Asgard',
    resources: {
      ...healthyRealm.resources,
      gpuCount: 0,
    },
  };

  describe('Compact variant (default)', () => {
    it('renders realm name', () => {
      render(<RealmCard realm={healthyRealm} />);
      expect(screen.getByText('Valhalla')).toBeInTheDocument();
    });

    it('renders realm description', () => {
      render(<RealmCard realm={healthyRealm} />);
      expect(screen.getByText('AI/ML GPU cluster')).toBeInTheDocument();
    });

    it('renders valkyrie name when online', () => {
      render(<RealmCard realm={healthyRealm} />);
      expect(screen.getByText('Sigrdrifa')).toBeInTheDocument();
    });

    it('renders observation count', () => {
      render(<RealmCard realm={healthyRealm} />);
      expect(screen.getByText('412 obs')).toBeInTheDocument();
    });

    it('renders location', () => {
      render(<RealmCard realm={healthyRealm} />);
      expect(screen.getByText('ca-hamilton-1')).toBeInTheDocument();
    });

    it('renders progress ring for pod health when online', () => {
      const { container } = render(<RealmCard realm={healthyRealm} />);
      const progressRing = container.querySelector('svg');
      expect(progressRing).toBeInTheDocument();
    });

    it('renders offline badge when offline', () => {
      render(<RealmCard realm={offlineRealm} />);
      expect(screen.getByText('offline')).toBeInTheDocument();
    });

    it('does not render valkyrie info when offline', () => {
      render(<RealmCard realm={offlineRealm} />);
      expect(screen.queryByText('Sigrdrifa')).not.toBeInTheDocument();
    });

    it('renders deploy button when offline', () => {
      render(<RealmCard realm={offlineRealm} />);
      expect(screen.getByText('Deploy Valkyrie')).toBeInTheDocument();
    });

    it('calls onClick when clicked and online', () => {
      const handleClick = vi.fn();
      render(<RealmCard realm={healthyRealm} onClick={handleClick} />);

      const card = screen.getByText('Valhalla').closest('div[class*="card"]');
      fireEvent.click(card!);

      expect(handleClick).toHaveBeenCalledWith(healthyRealm);
    });

    it('does not call onClick when clicked and offline', () => {
      const handleClick = vi.fn();
      render(<RealmCard realm={offlineRealm} onClick={handleClick} />);

      const card = screen.getByText('Ymir').closest('div[class*="card"]');
      fireEvent.click(card!);

      expect(handleClick).not.toHaveBeenCalled();
    });

    it('applies online style when healthy', () => {
      const { container } = render(<RealmCard realm={healthyRealm} />);
      const card = container.firstChild as HTMLElement;
      expect(card.className).toMatch(/online/);
    });

    it('applies offline style when offline', () => {
      const { container } = render(<RealmCard realm={offlineRealm} />);
      const card = container.firstChild as HTMLElement;
      expect(card.className).toMatch(/offline/);
    });

    it('applies custom className', () => {
      const { container } = render(<RealmCard realm={healthyRealm} className="custom-class" />);
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  describe('Detailed variant', () => {
    it('renders detailed variant when specified', () => {
      const { container } = render(<RealmCard realm={healthyRealm} variant="detailed" />);
      const card = container.firstChild as HTMLElement;
      expect(card.className).toMatch(/detailed/);
    });

    it('renders realm name in detailed mode', () => {
      render(<RealmCard realm={healthyRealm} variant="detailed" />);
      expect(screen.getByText('Valhalla')).toBeInTheDocument();
    });

    it('renders location in detailed mode', () => {
      render(<RealmCard realm={healthyRealm} variant="detailed" />);
      expect(screen.getByText('ca-hamilton-1')).toBeInTheDocument();
    });

    it('renders status badge in detailed mode', () => {
      render(<RealmCard realm={healthyRealm} variant="detailed" />);
      expect(screen.getByText('healthy')).toBeInTheDocument();
    });

    it('renders valkyrie section when online with valkyrie', () => {
      render(<RealmCard realm={healthyRealm} variant="detailed" />);
      expect(screen.getByText('Sigrdrifa')).toBeInTheDocument();
      expect(screen.getByText('AI/ML workloads')).toBeInTheDocument();
    });

    it('renders valkyrie stats in detailed mode', () => {
      render(<RealmCard realm={healthyRealm} variant="detailed" />);
      expect(screen.getByText('412')).toBeInTheDocument();
      expect(screen.getByText('observations')).toBeInTheDocument();
      expect(screen.getByText('14d 07:23:41')).toBeInTheDocument();
      expect(screen.getByText('uptime')).toBeInTheDocument();
    });

    it('renders pod running stats', () => {
      render(<RealmCard realm={healthyRealm} variant="detailed" />);
      expect(screen.getByText('14/15 running')).toBeInTheDocument();
    });

    it('renders GPU count when GPUs exist', () => {
      render(<RealmCard realm={healthyRealm} variant="detailed" />);
      expect(screen.getByText('6')).toBeInTheDocument();
    });

    it('does not render GPU stats when no GPUs', () => {
      render(<RealmCard realm={realmNoGpus} variant="detailed" />);
      expect(screen.queryByText('GPUs')).not.toBeInTheDocument();
    });

    it('renders memory stats', () => {
      render(<RealmCard realm={healthyRealm} variant="detailed" />);
      expect(screen.getByText('360/384 GiB')).toBeInTheDocument();
    });

    it('renders health reason when present', () => {
      render(<RealmCard realm={warningRealm} variant="detailed" />);
      expect(screen.getByText('1 volume degraded')).toBeInTheDocument();
    });

    it('does not render health reason when empty', () => {
      render(<RealmCard realm={healthyRealm} variant="detailed" />);
      expect(screen.queryByText('1 volume degraded')).not.toBeInTheDocument();
    });

    it('renders no valkyrie section when offline', () => {
      render(<RealmCard realm={offlineRealm} variant="detailed" />);
      expect(screen.getByText('No Valkyrie deployed')).toBeInTheDocument();
    });

    it('renders deploy button in detailed mode when offline', () => {
      render(<RealmCard realm={offlineRealm} variant="detailed" />);
      expect(screen.getByText('Deploy Valkyrie')).toBeInTheDocument();
    });

    it('calls onClick in detailed mode when online', () => {
      const handleClick = vi.fn();
      render(<RealmCard realm={healthyRealm} variant="detailed" onClick={handleClick} />);

      const card = screen.getByText('Valhalla').closest('div[class*="card"]');
      fireEvent.click(card!);

      expect(handleClick).toHaveBeenCalledWith(healthyRealm);
    });
  });

  describe('Different status colors', () => {
    it('uses emerald color for healthy realm', () => {
      const { container } = render(<RealmCard realm={healthyRealm} variant="detailed" />);
      const progressFill = container.querySelector('[class*="progressFill"]');
      expect(progressFill).toHaveStyle({ backgroundColor: 'var(--color-accent-emerald)' });
    });

    it('uses amber color for warning realm', () => {
      const { container } = render(<RealmCard realm={warningRealm} variant="detailed" />);
      const progressFill = container.querySelector('[class*="progressFill"]');
      expect(progressFill).toHaveStyle({ backgroundColor: 'var(--color-accent-amber)' });
    });

    it('uses red color for critical realm', () => {
      const criticalRealm: Realm = {
        ...warningRealm,
        id: 'critical-realm',
        name: 'Critical Realm',
        status: 'critical',
        health: { ...warningRealm.health, status: 'critical', reason: 'Node failure' },
      };
      const { container } = render(<RealmCard realm={criticalRealm} variant="detailed" />);
      const progressFill = container.querySelector('[class*="progressFill"]');
      expect(progressFill).toHaveStyle({ backgroundColor: 'var(--color-accent-red)' });
    });
  });
});
