import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { IssueBadge } from './IssueBadge';

describe('IssueBadge', () => {
  it('renders identifier and title', () => {
    render(<IssueBadge identifier="NIU-42" title="Fix auth bug" />);

    expect(screen.getByText('NIU-42')).toBeInTheDocument();
    expect(screen.getByText('Fix auth bug')).toBeInTheDocument();
  });

  it('renders as a link when url is provided', () => {
    render(
      <IssueBadge identifier="NIU-42" title="Fix auth bug" url="https://linear.app/issue/NIU-42" />
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://linear.app/issue/NIU-42');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders as a span when no url is provided', () => {
    render(<IssueBadge identifier="NIU-42" title="Fix auth bug" />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('NIU-42').closest('span')).toBeInTheDocument();
  });
});
