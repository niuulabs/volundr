import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MimirConsultation } from '@/models';
import { ConsultationCard } from './ConsultationCard';

describe('ConsultationCard', () => {
  const odinConsultation: MimirConsultation = {
    id: 'mimir-001',
    time: '10:20',
    requester: 'Odin',
    topic: 'Kubernetes HPA tuning',
    query:
      'What are the best practices for tuning Horizontal Pod Autoscaler for a memory-intensive analytics workload?',
    response: 'For memory-intensive workloads with bursty traffic...',
    tokensIn: 89,
    tokensOut: 423,
    latency: 2.1,
    useful: true,
  };

  const tyrConsultation: MimirConsultation = {
    id: 'mimir-002',
    time: '09:45',
    requester: 'Tyr',
    topic: 'Git merge strategy',
    query:
      'When coordinating changes across 4 repositories with circular dependencies, what merge order minimizes CI failures?',
    response: 'For circular dependencies across repos...',
    tokensIn: 67,
    tokensOut: 512,
    latency: 2.8,
    useful: false,
  };

  it('renders requester name', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    expect(screen.getByText('Odin')).toBeInTheDocument();
  });

  it('renders topic', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    expect(screen.getByText('Kubernetes HPA tuning')).toBeInTheDocument();
  });

  it('renders time', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    expect(screen.getByText('10:20')).toBeInTheDocument();
  });

  it('renders query text', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    expect(screen.getByText(/What are the best practices/)).toBeInTheDocument();
  });

  it('renders total token count', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    expect(screen.getByText('512 tokens')).toBeInTheDocument();
  });

  it('renders latency', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    expect(screen.getByText('2.1s')).toBeInTheDocument();
  });

  it('renders useful indicator when useful', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    expect(screen.getByText('useful')).toBeInTheDocument();
  });

  it('renders not useful indicator when not useful', () => {
    render(<ConsultationCard consultation={tyrConsultation} />);
    expect(screen.getByText('not useful')).toBeInTheDocument();
  });

  it('applies odin style for Odin requester', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    const requester = screen.getByText('Odin');
    expect(requester.className).toMatch(/odin/);
  });

  it('does not apply odin style for other requesters', () => {
    render(<ConsultationCard consultation={tyrConsultation} />);
    const requester = screen.getByText('Tyr');
    expect(requester.className).not.toMatch(/odin/);
  });

  it('applies selected style when selected', () => {
    const { container } = render(
      <ConsultationCard consultation={odinConsultation} selected={true} />
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toMatch(/selected/);
  });

  it('does not apply selected style by default', () => {
    const { container } = render(<ConsultationCard consultation={odinConsultation} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).not.toMatch(/selected/);
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<ConsultationCard consultation={odinConsultation} onClick={handleClick} />);

    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders as button element', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <ConsultationCard consultation={odinConsultation} className="custom-class" />
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('renders arrow separator', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    expect(screen.getByText('→')).toBeInTheDocument();
  });

  it('renders thumbs up icon for useful', () => {
    render(<ConsultationCard consultation={odinConsultation} />);
    const usefulSection = screen.getByText('useful').closest('span');
    const icon = usefulSection?.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('renders thumbs down icon for not useful', () => {
    render(<ConsultationCard consultation={tyrConsultation} />);
    const notUsefulSection = screen.getByText('not useful').closest('span');
    const icon = notUsefulSection?.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });
});
