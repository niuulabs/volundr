import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Realm, Einherjar } from '@/models';
import { RealmDetailModal } from './RealmDetailModal';

describe('RealmDetailModal', () => {
  const realm: Realm = {
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

  const realmNoGpus: Realm = {
    ...realm,
    resources: {
      ...realm.resources,
      gpuCount: 0,
    },
  };

  const realmNoValkyrie: Realm = {
    ...realm,
    valkyrie: null,
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

  const einherjar: Einherjar[] = [
    {
      id: 'ein-1',
      name: 'Skuld-Alpha',
      status: 'working',
      task: 'Implementing storage adapter',
      realm: 'valhalla',
      campaign: 'campaign-1',
      progress: 75,
      model: 'qwen3-70b',
    },
    {
      id: 'ein-2',
      name: 'Skuld-Beta',
      status: 'idle',
      task: 'Awaiting next task',
      realm: 'valhalla',
      campaign: null,
      progress: null,
      model: 'qwen3-32b',
    },
    {
      id: 'ein-3',
      name: 'Skuld-Gamma',
      status: 'working',
      task: 'Other realm task',
      realm: 'midgard',
      campaign: 'campaign-2',
      progress: 50,
      model: 'claude-opus',
    },
  ];

  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when realm is null', () => {
    const { container } = render(<RealmDetailModal realm={null} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with realm name as title', () => {
    render(<RealmDetailModal realm={realm} onClose={onClose} />);
    expect(screen.getByText('Valhalla')).toBeInTheDocument();
  });

  it('renders realm description as subtitle', () => {
    render(<RealmDetailModal realm={realm} onClose={onClose} />);
    expect(screen.getByText('AI/ML GPU cluster')).toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    render(<RealmDetailModal realm={realm} onClose={onClose} />);
    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalled();
  });

  describe('Valkyrie section', () => {
    it('renders valkyrie name when present', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('Sigrdrifa')).toBeInTheDocument();
    });

    it('renders valkyrie specialty', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('AI/ML workloads')).toBeInTheDocument();
    });

    it('renders valkyrie status badge', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('observing')).toBeInTheDocument();
    });

    it('renders valkyrie observations count', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('412')).toBeInTheDocument();
      expect(screen.getByText('observations today')).toBeInTheDocument();
    });

    it('renders valkyrie uptime', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('14d 07:23:41')).toBeInTheDocument();
      expect(screen.getByText('uptime')).toBeInTheDocument();
    });

    it('does not render valkyrie section when no valkyrie', () => {
      render(<RealmDetailModal realm={realmNoValkyrie} onClose={onClose} />);
      expect(screen.queryByText('Sigrdrifa')).not.toBeInTheDocument();
    });
  });

  describe('Resources section', () => {
    it('renders pod count as running/total', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('14/15 running')).toBeInTheDocument();
    });

    it('renders memory as allocatable/capacity with unit', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('360/384 GiB')).toBeInTheDocument();
    });

    it('renders CPU as allocatable/capacity with unit', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('44/48 cores')).toBeInTheDocument();
    });

    it('renders GPU count when GPUs present', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('6')).toBeInTheDocument();
    });

    it('does not render GPU section when no GPUs', () => {
      render(<RealmDetailModal realm={realmNoGpus} onClose={onClose} />);
      expect(screen.queryByText('GPUs')).not.toBeInTheDocument();
    });
  });

  describe('Health section', () => {
    it('renders nodes ready count', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('3/3 nodes ready')).toBeInTheDocument();
    });

    it('renders health reason when present', () => {
      render(<RealmDetailModal realm={warningRealm} onClose={onClose} />);
      expect(screen.getByText('1 volume degraded')).toBeInTheDocument();
    });

    it('does not render health reason when empty', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      // realm.health.reason is '', so no reason tag should be rendered
      expect(screen.queryByText('1 volume degraded')).not.toBeInTheDocument();
    });
  });

  describe('Pod Breakdown section', () => {
    it('renders pod breakdown heading', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('Pod Breakdown')).toBeInTheDocument();
    });

    it('renders running pod count', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('Running')).toBeInTheDocument();
    });

    it('renders pending count when pending > 0', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });

    it('does not render pending when pending is 0', () => {
      render(<RealmDetailModal realm={warningRealm} onClose={onClose} />);
      expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    });

    it('renders failed count when failed > 0', () => {
      render(<RealmDetailModal realm={warningRealm} onClose={onClose} />);
      expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('does not render failed when failed is 0', () => {
      render(<RealmDetailModal realm={realm} onClose={onClose} />);
      expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    });
  });

  describe('Einherjar section', () => {
    it('renders einherjar in this realm', () => {
      render(<RealmDetailModal realm={realm} einherjar={einherjar} onClose={onClose} />);
      expect(screen.getByText('Einherjar in Valhalla')).toBeInTheDocument();
    });

    it('renders only einherjar matching realm', () => {
      render(<RealmDetailModal realm={realm} einherjar={einherjar} onClose={onClose} />);
      expect(screen.getByText('Skuld-Alpha')).toBeInTheDocument();
      expect(screen.getByText('Skuld-Beta')).toBeInTheDocument();
      expect(screen.queryByText('Skuld-Gamma')).not.toBeInTheDocument();
    });

    it('renders einherjar tasks', () => {
      render(<RealmDetailModal realm={realm} einherjar={einherjar} onClose={onClose} />);
      expect(screen.getByText('Implementing storage adapter')).toBeInTheDocument();
    });

    it('renders einherjar progress when available', () => {
      render(<RealmDetailModal realm={realm} einherjar={einherjar} onClose={onClose} />);
      expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('renders einherjar status badges', () => {
      render(<RealmDetailModal realm={realm} einherjar={einherjar} onClose={onClose} />);
      expect(screen.getByText('working')).toBeInTheDocument();
      expect(screen.getByText('idle')).toBeInTheDocument();
    });

    it('does not render einherjar section when no einherjar in realm', () => {
      const otherEinherjar = einherjar.filter(e => e.realm !== 'valhalla');
      render(<RealmDetailModal realm={realm} einherjar={otherEinherjar} onClose={onClose} />);
      expect(screen.queryByText('Einherjar in Valhalla')).not.toBeInTheDocument();
    });

    it('does not render einherjar section when einherjar array is empty', () => {
      render(<RealmDetailModal realm={realm} einherjar={[]} onClose={onClose} />);
      expect(screen.queryByText('Einherjar in Valhalla')).not.toBeInTheDocument();
    });
  });

  it('accepts className prop', () => {
    const { container } = render(
      <RealmDetailModal realm={realm} onClose={onClose} className="custom-class" />
    );
    expect(container.firstChild).toBeInTheDocument();
  });
});
