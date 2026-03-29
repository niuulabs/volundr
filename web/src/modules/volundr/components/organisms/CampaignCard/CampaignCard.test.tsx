import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Campaign } from '@/modules/volundr/models';
import { CampaignCard } from './CampaignCard';

describe('CampaignCard', () => {
  const activeCampaign: Campaign = {
    id: 'campaign-1',
    name: 'Storage Migration',
    description: 'Migrate all services to new storage backend',
    status: 'active',
    progress: 65,
    confidence: 0.87,
    mergeThreshold: 0.85,
    phases: [],
    einherjar: ['ein-1', 'ein-2'],
    started: '2024-01-15',
    eta: '3 days',
    repoAccess: ['repo-1'],
  };

  const queuedCampaign: Campaign = {
    id: 'campaign-2',
    name: 'API Refactor',
    description: 'Refactor API endpoints for v2',
    status: 'queued',
    progress: 0,
    confidence: null,
    mergeThreshold: 0.85,
    phases: [],
    einherjar: ['ein-3'],
    started: null,
    eta: '1 week',
    repoAccess: ['repo-2'],
  };

  const completeCampaign: Campaign = {
    id: 'campaign-3',
    name: 'Database Upgrade',
    description: 'Upgrade PostgreSQL to v16',
    status: 'complete',
    progress: 100,
    confidence: 0.95,
    mergeThreshold: 0.85,
    phases: [],
    einherjar: [],
    started: '2024-01-01',
    eta: 'Done',
    repoAccess: ['repo-3'],
  };

  const lowConfidenceCampaign: Campaign = {
    ...activeCampaign,
    id: 'campaign-4',
    confidence: 0.75,
    mergeThreshold: 0.85,
  };

  it('renders campaign name', () => {
    render(<CampaignCard campaign={activeCampaign} />);
    expect(screen.getByText('Storage Migration')).toBeInTheDocument();
  });

  it('renders campaign description', () => {
    render(<CampaignCard campaign={activeCampaign} />);
    expect(screen.getByText('Migrate all services to new storage backend')).toBeInTheDocument();
  });

  it('renders status badge', () => {
    render(<CampaignCard campaign={activeCampaign} />);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders progress for active campaign', () => {
    render(<CampaignCard campaign={activeCampaign} />);
    expect(screen.getByText('65%')).toBeInTheDocument();
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('does not render progress for queued campaign', () => {
    render(<CampaignCard campaign={queuedCampaign} />);
    expect(screen.queryByText('Progress')).not.toBeInTheDocument();
  });

  it('renders progress for complete campaign', () => {
    render(<CampaignCard campaign={completeCampaign} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders confidence when available', () => {
    render(<CampaignCard campaign={activeCampaign} />);
    expect(screen.getByText('Conf: 87%')).toBeInTheDocument();
  });

  it('does not render confidence when null', () => {
    render(<CampaignCard campaign={queuedCampaign} />);
    expect(screen.queryByText(/Conf:/)).not.toBeInTheDocument();
  });

  it('renders ETA', () => {
    render(<CampaignCard campaign={activeCampaign} />);
    expect(screen.getByText('ETA: 3 days')).toBeInTheDocument();
  });

  it('renders worker count', () => {
    render(<CampaignCard campaign={activeCampaign} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('applies active status style', () => {
    const { container } = render(<CampaignCard campaign={activeCampaign} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toMatch(/active/);
  });

  it('applies queued status style', () => {
    const { container } = render(<CampaignCard campaign={queuedCampaign} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toMatch(/queued/);
  });

  it('applies complete status style', () => {
    const { container } = render(<CampaignCard campaign={completeCampaign} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toMatch(/complete/);
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<CampaignCard campaign={activeCampaign} onClick={handleClick} />);

    const card = screen.getByText('Storage Migration').closest('div');
    fireEvent.click(card!);

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick).toHaveBeenCalledWith(activeCampaign);
  });

  it('applies custom className', () => {
    const { container } = render(
      <CampaignCard campaign={activeCampaign} className="custom-class" />
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('shows high confidence style when above threshold', () => {
    const { container } = render(<CampaignCard campaign={activeCampaign} />);
    const confidenceEl = container.querySelector('[class*="confidenceHigh"]');
    expect(confidenceEl).toBeInTheDocument();
  });

  it('shows low confidence style when below threshold', () => {
    const { container } = render(<CampaignCard campaign={lowConfidenceCampaign} />);
    const confidenceEl = container.querySelector('[class*="confidenceLow"]');
    expect(confidenceEl).toBeInTheDocument();
  });

  it('renders pulsing status dot for active campaign', () => {
    const { container } = render(<CampaignCard campaign={activeCampaign} />);
    const statusDot = container.querySelector('[class*="pulse"]');
    expect(statusDot).toBeInTheDocument();
  });

  it('renders non-pulsing status dot for queued campaign', () => {
    const { container } = render(<CampaignCard campaign={queuedCampaign} />);
    const statusDot = container.querySelector('[class*="pulse"]');
    expect(statusDot).not.toBeInTheDocument();
  });
});
