import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Settings } from 'lucide-react';
import { CollapsibleSection } from './CollapsibleSection';

const defaultProps = {
  storageKey: 'test-section',
  title: 'Test Section',
  description: 'A test description',
  icon: Settings,
  accentColor: 'amber' as const,
};

describe('CollapsibleSection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders expanded by default with description visible', () => {
    render(<CollapsibleSection {...defaultProps} />);

    expect(screen.getByText('Test Section')).toBeInTheDocument();
    expect(screen.getByText('A test description')).toBeInTheDocument();
  });

  it('renders collapsed when defaultCollapsed is true', () => {
    render(<CollapsibleSection {...defaultProps} defaultCollapsed />);

    expect(screen.getByText('Test Section')).toBeInTheDocument();
    expect(screen.queryByText('A test description')).not.toBeInTheDocument();
  });

  it('toggles collapsed state on header click', () => {
    render(<CollapsibleSection {...defaultProps} />);

    expect(screen.getByText('A test description')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByText('A test description')).not.toBeInTheDocument();
  });

  it('renders footer items when provided', () => {
    render(<CollapsibleSection {...defaultProps} footerItems={['Item A', 'Item B']} />);

    expect(screen.getByText('Item A')).toBeInTheDocument();
    expect(screen.getByText('Item B')).toBeInTheDocument();
  });

  it('renders children when expanded', () => {
    render(
      <CollapsibleSection {...defaultProps}>
        <span>Child content</span>
      </CollapsibleSection>
    );

    expect(screen.getByText('Child content')).toBeInTheDocument();
  });

  it('does not render footer when footerItems is empty', () => {
    render(<CollapsibleSection {...defaultProps} footerItems={[]} />);

    expect(screen.getByText('A test description')).toBeInTheDocument();
  });
});
