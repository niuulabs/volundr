import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsBar } from './StatsBar';
import type { MimirStats } from '@/domain';

describe('StatsBar', () => {
  const stats: MimirStats = {
    pageCount: 42,
    categories: ['technical', 'projects', 'ops'],
    healthy: true,
  };

  describe('when stats is null', () => {
    it('shows loading text', () => {
      render(<StatsBar stats={null} instanceName="local" />);
      expect(screen.getByText('Loading stats…')).toBeDefined();
    });

    it('shows instance name even when loading', () => {
      render(<StatsBar stats={null} instanceName="production" />);
      expect(screen.getByText('production')).toBeDefined();
    });
  });

  describe('when stats are available', () => {
    it('shows the page count', () => {
      render(<StatsBar stats={stats} instanceName="local" />);
      expect(screen.getByText('42')).toBeDefined();
    });

    it('shows the category count', () => {
      render(<StatsBar stats={stats} instanceName="local" />);
      expect(screen.getByText('3')).toBeDefined();
    });

    it('shows "healthy" when healthy=true', () => {
      render(<StatsBar stats={stats} instanceName="local" />);
      expect(screen.getByText('healthy')).toBeDefined();
    });

    it('shows "degraded" when healthy=false', () => {
      render(<StatsBar stats={{ ...stats, healthy: false }} instanceName="local" />);
      expect(screen.getByText('degraded')).toBeDefined();
    });

    it('shows the instance name', () => {
      render(<StatsBar stats={stats} instanceName="my-instance" />);
      expect(screen.getByText('my-instance')).toBeDefined();
    });

    it('renders pages label', () => {
      render(<StatsBar stats={stats} instanceName="local" />);
      expect(screen.getByText('pages')).toBeDefined();
    });

    it('renders categories label', () => {
      render(<StatsBar stats={stats} instanceName="local" />);
      expect(screen.getByText('categories')).toBeDefined();
    });
  });
});
