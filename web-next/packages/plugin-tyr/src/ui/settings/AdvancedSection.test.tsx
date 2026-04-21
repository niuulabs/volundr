import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvancedSection } from './AdvancedSection';

describe('AdvancedSection', () => {
  it('renders the section heading', () => {
    render(<AdvancedSection />);
    expect(screen.getByText('Advanced')).toBeInTheDocument();
  });

  it('renders the description', () => {
    render(<AdvancedSection />);
    expect(
      screen.getByText('Danger zone. These actions can disrupt running sagas and raids.'),
    ).toBeInTheDocument();
  });

  it('renders all 3 action rows', () => {
    render(<AdvancedSection />);
    expect(screen.getByText('Flush queue')).toBeInTheDocument();
    expect(screen.getByText('Reset dispatcher')).toBeInTheDocument();
    expect(screen.getByText('Rebuild confidence scores')).toBeInTheDocument();
  });

  it('renders the action buttons', () => {
    render(<AdvancedSection />);
    expect(screen.getByText('Flush')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
    expect(screen.getByText('Rebuild')).toBeInTheDocument();
  });

  it('shows confirmation text on first click of a danger button', () => {
    render(<AdvancedSection />);
    const flushBtn = screen.getByTestId('action-flush-queue');
    fireEvent.click(flushBtn);
    expect(screen.getByText('Click again to confirm')).toBeInTheDocument();
  });

  it('hides confirmation text on second click (cancel)', () => {
    render(<AdvancedSection />);
    const flushBtn = screen.getByTestId('action-flush-queue');
    fireEvent.click(flushBtn);
    expect(screen.getByText('Click again to confirm')).toBeInTheDocument();
    fireEvent.click(flushBtn);
    expect(screen.queryByText('Click again to confirm')).not.toBeInTheDocument();
  });

  it('has an accessible section label', () => {
    render(<AdvancedSection />);
    expect(screen.getByRole('region', { name: /advanced settings/i })).toBeInTheDocument();
  });

  it('renders 3 action buttons total', () => {
    render(<AdvancedSection />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
  });
});
