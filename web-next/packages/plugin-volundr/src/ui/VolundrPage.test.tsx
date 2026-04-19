import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VolundrPage } from './VolundrPage';

describe('VolundrPage', () => {
  it('renders the plugin title', () => {
    render(<VolundrPage />);
    expect(screen.getByText('Völundr · session forge')).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    render(<VolundrPage />);
    expect(screen.getByText('Provision and manage remote dev sessions')).toBeInTheDocument();
  });

  it('renders the rune glyph', () => {
    render(<VolundrPage />);
    expect(screen.getByText('ᚲ')).toBeInTheDocument();
  });

  it('renders the coming-soon message', () => {
    render(<VolundrPage />);
    expect(screen.getByText(/Full UI coming soon/)).toBeInTheDocument();
  });
});
