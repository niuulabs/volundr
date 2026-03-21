import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Einherjar } from '@/modules/volundr/models';
import { EinherjarCard } from './EinherjarCard';

describe('EinherjarCard', () => {
  const workingEinherjar: Einherjar = {
    id: 'ein-valhalla-001',
    name: 'ein-valhalla-001',
    status: 'working',
    realm: 'valhalla',
    campaign: 'campaign-001',
    phase: 'phase-2',
    task: 'Writing storage observer unit tests',
    progress: 78,
    contextUsed: 45,
    contextMax: 128,
    cyclesSinceCheckpoint: 12,
  };

  const idleEinherjar: Einherjar = {
    id: 'ein-valhalla-005',
    name: 'ein-valhalla-005',
    status: 'idle',
    realm: 'valhalla',
    campaign: null,
    phase: null,
    task: 'Awaiting assignment',
    progress: null,
    contextUsed: 0,
    contextMax: 128,
    cyclesSinceCheckpoint: 0,
  };

  it('renders einherjar name', () => {
    render(<EinherjarCard einherjar={workingEinherjar} />);
    expect(screen.getByText('ein-valhalla-001')).toBeInTheDocument();
  });

  it('renders realm', () => {
    render(<EinherjarCard einherjar={workingEinherjar} />);
    expect(screen.getByText('valhalla')).toBeInTheDocument();
  });

  it('renders task', () => {
    render(<EinherjarCard einherjar={workingEinherjar} />);
    expect(screen.getByText('Writing storage observer unit tests')).toBeInTheDocument();
  });

  it('renders status badge', () => {
    render(<EinherjarCard einherjar={workingEinherjar} />);
    expect(screen.getByText('working')).toBeInTheDocument();
  });

  it('renders progress when provided', () => {
    render(<EinherjarCard einherjar={workingEinherjar} />);
    expect(screen.getByText('78%')).toBeInTheDocument();
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('does not render progress for idle worker', () => {
    render(<EinherjarCard einherjar={idleEinherjar} />);
    expect(screen.queryByText('Progress')).not.toBeInTheDocument();
  });

  it('renders context usage', () => {
    render(<EinherjarCard einherjar={workingEinherjar} />);
    expect(screen.getByText('Context: 45/128k')).toBeInTheDocument();
  });

  it('renders cycles since checkpoint when > 0', () => {
    render(<EinherjarCard einherjar={workingEinherjar} />);
    expect(screen.getByText('12 cycles since checkpoint')).toBeInTheDocument();
  });

  it('does not render cycles when 0', () => {
    render(<EinherjarCard einherjar={idleEinherjar} />);
    expect(screen.queryByText(/cycles since checkpoint/)).not.toBeInTheDocument();
  });

  it('renders campaign name when provided', () => {
    render(<EinherjarCard einherjar={workingEinherjar} campaignName="Storage Health Observer" />);
    expect(screen.getByText('Storage Health Observer')).toBeInTheDocument();
  });

  it('does not render campaign name when not provided', () => {
    render(<EinherjarCard einherjar={idleEinherjar} />);
    expect(screen.queryByText('Storage Health Observer')).not.toBeInTheDocument();
  });

  it('applies working style when status is working', () => {
    const { container } = render(<EinherjarCard einherjar={workingEinherjar} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toMatch(/working/);
  });

  it('does not apply working style when idle', () => {
    const { container } = render(<EinherjarCard einherjar={idleEinherjar} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).not.toMatch(/working/);
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<EinherjarCard einherjar={workingEinherjar} onClick={handleClick} />);

    const card = screen.getByRole('button');
    fireEvent.click(card);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('has button role when onClick is provided', () => {
    render(<EinherjarCard einherjar={workingEinherjar} onClick={() => {}} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not have button role when onClick is not provided', () => {
    render(<EinherjarCard einherjar={workingEinherjar} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <EinherjarCard einherjar={workingEinherjar} className="custom-class" />
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('applies warning style for high cycles', () => {
    const highCyclesEinherjar: Einherjar = {
      ...workingEinherjar,
      cyclesSinceCheckpoint: 15,
    };
    render(<EinherjarCard einherjar={highCyclesEinherjar} />);

    const cyclesElement = screen.getByText('15 cycles since checkpoint');
    expect(cyclesElement.className).toMatch(/cyclesWarning/);
  });

  it('does not apply warning style for low cycles', () => {
    const lowCyclesEinherjar: Einherjar = {
      ...workingEinherjar,
      cyclesSinceCheckpoint: 5,
    };
    render(<EinherjarCard einherjar={lowCyclesEinherjar} />);

    const cyclesElement = screen.getByText('5 cycles since checkpoint');
    expect(cyclesElement.className).not.toMatch(/cyclesWarning/);
  });
});
