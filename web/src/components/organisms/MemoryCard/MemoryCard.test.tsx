import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Memory } from '@/models';
import { MemoryCard } from './MemoryCard';

describe('MemoryCard', () => {
  const preferenceMemory: Memory = {
    id: 'mem-001',
    type: 'preference',
    content: 'Jozef prefers concise alerts, save details for dashboard',
    confidence: 0.95,
    lastUsed: '2h ago',
    usageCount: 47,
  };

  const patternMemory: Memory = {
    id: 'mem-002',
    type: 'pattern',
    content: 'Thursday 3pm: CI runners spike from scheduled builds',
    confidence: 0.89,
    lastUsed: '4d ago',
    usageCount: 12,
  };

  it('renders memory type badge', () => {
    render(<MemoryCard memory={preferenceMemory} />);
    expect(screen.getByText('preference')).toBeInTheDocument();
  });

  it('renders memory content', () => {
    render(<MemoryCard memory={preferenceMemory} />);
    expect(
      screen.getByText('Jozef prefers concise alerts, save details for dashboard')
    ).toBeInTheDocument();
  });

  it('renders usage count', () => {
    render(<MemoryCard memory={preferenceMemory} />);
    expect(screen.getByText(/Used 47x/)).toBeInTheDocument();
  });

  it('renders last used time', () => {
    render(<MemoryCard memory={preferenceMemory} />);
    expect(screen.getByText(/Last: 2h ago/)).toBeInTheDocument();
  });

  it('renders confidence percentage', () => {
    render(<MemoryCard memory={preferenceMemory} />);
    expect(screen.getByText('95%')).toBeInTheDocument();
  });

  it('renders confidence label', () => {
    render(<MemoryCard memory={preferenceMemory} />);
    expect(screen.getByText('Confidence:')).toBeInTheDocument();
  });

  it('applies correct style for preference type', () => {
    render(<MemoryCard memory={preferenceMemory} />);
    const typeBadge = screen.getByText('preference');
    expect(typeBadge.className).toMatch(/preference/);
  });

  it('applies correct style for pattern type', () => {
    render(<MemoryCard memory={patternMemory} />);
    const typeBadge = screen.getByText('pattern');
    expect(typeBadge.className).toMatch(/pattern/);
  });

  it('applies correct style for fact type', () => {
    const factMemory: Memory = {
      ...preferenceMemory,
      type: 'fact',
    };
    render(<MemoryCard memory={factMemory} />);
    const typeBadge = screen.getByText('fact');
    expect(typeBadge.className).toMatch(/fact/);
  });

  it('applies correct style for outcome type', () => {
    const outcomeMemory: Memory = {
      ...preferenceMemory,
      type: 'outcome',
    };
    render(<MemoryCard memory={outcomeMemory} />);
    const typeBadge = screen.getByText('outcome');
    expect(typeBadge.className).toMatch(/outcome/);
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<MemoryCard memory={preferenceMemory} onClick={handleClick} />);

    const card = screen.getByRole('button');
    fireEvent.click(card);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('has button role when onClick is provided', () => {
    render(<MemoryCard memory={preferenceMemory} onClick={() => {}} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('does not have button role when onClick is not provided', () => {
    render(<MemoryCard memory={preferenceMemory} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(<MemoryCard memory={preferenceMemory} className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('rounds confidence to nearest percent', () => {
    const memoryWithOddConfidence: Memory = {
      ...preferenceMemory,
      confidence: 0.876,
    };
    render(<MemoryCard memory={memoryWithOddConfidence} />);
    expect(screen.getByText('88%')).toBeInTheDocument();
  });

  it('handles 100% confidence', () => {
    const fullConfidenceMemory: Memory = {
      ...preferenceMemory,
      confidence: 1.0,
    };
    render(<MemoryCard memory={fullConfidenceMemory} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('handles 0% confidence', () => {
    const zeroConfidenceMemory: Memory = {
      ...preferenceMemory,
      confidence: 0,
    };
    render(<MemoryCard memory={zeroConfidenceMemory} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});
