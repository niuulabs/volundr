import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CircadianIcon } from './CircadianIcon';
import type { CircadianMode } from '@/models';

describe('CircadianIcon', () => {
  it('renders morning mode with Sunrise icon', () => {
    render(<CircadianIcon mode="morning" />);

    expect(screen.getByLabelText('morning mode')).toBeInTheDocument();
  });

  it('renders active mode with Sun icon', () => {
    render(<CircadianIcon mode="active" />);

    expect(screen.getByLabelText('active mode')).toBeInTheDocument();
  });

  it('renders evening mode with Sunset icon', () => {
    render(<CircadianIcon mode="evening" />);

    expect(screen.getByLabelText('evening mode')).toBeInTheDocument();
  });

  it('renders night mode with Moon icon', () => {
    render(<CircadianIcon mode="night" />);

    expect(screen.getByLabelText('night mode')).toBeInTheDocument();
  });

  it('renders with different size props', () => {
    const sizes: Array<'sm' | 'md' | 'lg'> = ['sm', 'md', 'lg'];

    for (const size of sizes) {
      const { unmount } = render(<CircadianIcon mode="active" size={size} />);
      const icon = screen.getByLabelText('active mode');
      // Icon renders successfully with size prop
      expect(icon).toBeInTheDocument();
      unmount();
    }
  });

  it('applies custom className', () => {
    render(<CircadianIcon mode="active" className="custom-class" />);

    const icon = screen.getByLabelText('active mode');
    expect(icon).toHaveClass('custom-class');
  });

  it('renders all mode variants', () => {
    const modes: CircadianMode[] = ['morning', 'active', 'evening', 'night'];

    for (const mode of modes) {
      const { unmount } = render(<CircadianIcon mode={mode} />);
      const icon = screen.getByLabelText(`${mode} mode`);
      // Icon renders successfully with mode prop
      expect(icon).toBeInTheDocument();
      unmount();
    }
  });
});
