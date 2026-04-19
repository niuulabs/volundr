import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiStrip } from './KpiStrip';
import { KpiCard } from '../KpiCard';

describe('KpiStrip', () => {
  it('renders children', () => {
    render(
      <KpiStrip>
        <KpiCard label="Sessions" value={12} />
        <KpiCard label="Errors" value={0} />
      </KpiStrip>,
    );
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
  });

  it('has group role', () => {
    render(
      <KpiStrip>
        <KpiCard label="A" value={1} />
      </KpiStrip>,
    );
    expect(screen.getByRole('group')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <KpiStrip className="custom">
        <KpiCard label="A" value={1} />
      </KpiStrip>,
    );
    expect(container.querySelector('.custom')).toBeInTheDocument();
  });
});
