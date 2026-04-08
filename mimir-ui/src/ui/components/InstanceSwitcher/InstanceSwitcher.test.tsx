import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InstanceSwitcher } from './InstanceSwitcher';

const instances = [
  { name: 'local', role: 'local' as const, writeEnabled: true },
  { name: 'production', role: 'shared' as const, writeEnabled: false },
  { name: 'domain-kb', role: 'domain' as const, writeEnabled: true },
];

describe('InstanceSwitcher', () => {
  it('renders all instance tabs', () => {
    render(
      <InstanceSwitcher instances={instances} activeName="local" onChange={vi.fn()} />,
    );
    expect(screen.getByText('local')).toBeDefined();
    expect(screen.getByText('production')).toBeDefined();
    expect(screen.getByText('domain-kb')).toBeDefined();
  });

  it('shows "rw" badge for write-enabled instances', () => {
    render(
      <InstanceSwitcher instances={instances} activeName="local" onChange={vi.fn()} />,
    );
    const rwBadges = screen.getAllByText('rw');
    expect(rwBadges.length).toBe(2); // local and domain-kb
  });

  it('does not show "rw" badge for read-only instances', () => {
    const { container } = render(
      <InstanceSwitcher
        instances={[{ name: 'production', role: 'shared', writeEnabled: false }]}
        activeName="production"
        onChange={vi.fn()}
      />,
    );
    expect(container.textContent).not.toContain('rw');
  });

  it('marks the active instance with aria-pressed=true', () => {
    render(
      <InstanceSwitcher instances={instances} activeName="local" onChange={vi.fn()} />,
    );
    const localButton = screen.getByRole('button', { name: /local/ });
    expect(localButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks inactive instances with aria-pressed=false', () => {
    render(
      <InstanceSwitcher instances={instances} activeName="local" onChange={vi.fn()} />,
    );
    const prodButton = screen.getByRole('button', { name: /production/ });
    expect(prodButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onChange with the correct name when tab clicked', () => {
    const onChange = vi.fn();
    render(
      <InstanceSwitcher instances={instances} activeName="local" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /production/ }));
    expect(onChange).toHaveBeenCalledWith('production');
  });

  it('renders empty nav when no instances', () => {
    const { container } = render(
      <InstanceSwitcher instances={[]} activeName="local" onChange={vi.fn()} />,
    );
    expect(container.querySelector('nav')).toBeDefined();
    expect(container.querySelectorAll('button').length).toBe(0);
  });
});
