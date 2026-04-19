import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DeployKind } from './DeployBadge';
import { DeployBadge } from './DeployBadge';

const ALL_KINDS: DeployKind[] = ['k8s', 'systemd', 'pi', 'mobile', 'ephemeral'];

describe('DeployBadge', () => {
  it('renders the kind label', () => {
    render(<DeployBadge kind="k8s" />);
    expect(screen.getByText('k8s')).toBeInTheDocument();
  });

  it('renders the k8s glyph ◇', () => {
    render(<DeployBadge kind="k8s" />);
    expect(screen.getByText('◇')).toBeInTheDocument();
  });

  it('renders the systemd glyph ◈', () => {
    render(<DeployBadge kind="systemd" />);
    expect(screen.getByText('◈')).toBeInTheDocument();
  });

  it('renders the pi glyph ◆', () => {
    render(<DeployBadge kind="pi" />);
    expect(screen.getByText('◆')).toBeInTheDocument();
  });

  it('renders the mobile glyph ▲', () => {
    render(<DeployBadge kind="mobile" />);
    expect(screen.getByText('▲')).toBeInTheDocument();
  });

  it('renders the ephemeral glyph ◌', () => {
    render(<DeployBadge kind="ephemeral" />);
    expect(screen.getByText('◌')).toBeInTheDocument();
  });

  it('has aria-label describing deployment kind', () => {
    render(<DeployBadge kind="k8s" />);
    expect(screen.getByLabelText('deployed via k8s')).toBeInTheDocument();
  });

  it('applies kind modifier class', () => {
    render(<DeployBadge kind="mobile" />);
    expect(screen.getByLabelText('deployed via mobile')).toHaveClass('niuu-deploy-badge--mobile');
  });

  it('applies custom className', () => {
    render(<DeployBadge kind="pi" className="my-class" />);
    expect(screen.getByLabelText('deployed via pi')).toHaveClass('my-class');
  });

  it('renders all kinds without throwing', () => {
    for (const kind of ALL_KINDS) {
      expect(() => render(<DeployBadge kind={kind} />)).not.toThrow();
    }
  });
});
