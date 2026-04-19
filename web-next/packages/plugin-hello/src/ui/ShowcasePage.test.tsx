import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShowcasePage } from './ShowcasePage';

describe('ShowcasePage', () => {
  it('renders the page title', () => {
    render(<ShowcasePage />);
    expect(screen.getByText('status composites · showcase')).toBeInTheDocument();
  });

  it('renders the StatusBadge section with all statuses', () => {
    render(<ShowcasePage />);
    const section = screen.getByTestId('status-badges');
    expect(section).toBeInTheDocument();
    expect(section.querySelectorAll('.niuu-status-badge')).toHaveLength(6);
  });

  it('renders the ConfidenceBar section with three levels', () => {
    render(<ShowcasePage />);
    const section = screen.getByTestId('confidence-bars');
    expect(section).toBeInTheDocument();
    expect(section.querySelectorAll('.niuu-confidence-bar')).toHaveLength(3);
  });

  it('renders the ConfidenceBadge section including empty state', () => {
    render(<ShowcasePage />);
    const section = screen.getByTestId('confidence-badges');
    expect(section).toBeInTheDocument();
    // null + 0 both render as em-dash
    const dashes = section.querySelectorAll('.niuu-confidence-badge--empty');
    expect(dashes).toHaveLength(2);
  });

  it('renders the Pipe section with pipes', () => {
    render(<ShowcasePage />);
    const section = screen.getByTestId('pipes');
    expect(section).toBeInTheDocument();
    expect(section.querySelectorAll('.niuu-pipe')).toHaveLength(3);
  });
});
