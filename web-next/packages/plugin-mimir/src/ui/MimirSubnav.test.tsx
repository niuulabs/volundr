import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { MimirSubnav } from './MimirSubnav';
import { renderWithMimir } from '../testing/renderWithMimir';
import type { PluginCtx } from '@niuulabs/plugin-sdk';

// Mock TanStack Router hooks — subnav uses useNavigate + useLocation
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/mimir' }),
}));

const mockCtx: PluginCtx = {
  tweaks: {},
  setTweak: vi.fn(),
};

const wrap = (ctx = mockCtx) => renderWithMimir(<MimirSubnav ctx={ctx} />);

describe('MimirSubnav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the navigation label', () => {
    wrap();
    expect(screen.getByText('Navigation')).toBeInTheDocument();
  });

  it('renders the mount focus section', () => {
    wrap();
    expect(screen.getByText('Mount focus')).toBeInTheDocument();
  });

  it('renders "All mounts" button', () => {
    wrap();
    expect(screen.getByText('All mounts')).toBeInTheDocument();
  });

  it('renders all nav items: Overview, Pages, Search, etc.', () => {
    wrap();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Pages')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Graph')).toBeInTheDocument();
    expect(screen.getByText('Wardens')).toBeInTheDocument();
    expect(screen.getByText('Routing')).toBeInTheDocument();
    expect(screen.getByText('Lint')).toBeInTheDocument();
    expect(screen.getByText('Dreams')).toBeInTheDocument();
  });

  it('renders quick filters section', () => {
    wrap();
    expect(screen.getByText('Quick filters')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
  });

  it('renders per-mount rows after data loads', async () => {
    wrap();
    // Mock data has mounts: local, shared, platform
    // Both name and role cells show 'local' for the first mount, so use getAllByText
    await waitFor(() => expect(screen.getAllByText('local').length).toBeGreaterThan(0));
  });

  it('renders wardens roster when ravns are present', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Wardens')).toBeInTheDocument());
    // ravns from mock: ravn-fjolnir, ravn-skald
    await waitFor(() => expect(screen.getByText('ravn-fjolnir')).toBeInTheDocument());
  });

  it('clicking "All mounts" calls setTweak with "all"', () => {
    const setTweak = vi.fn();
    wrap({ tweaks: {}, setTweak });
    fireEvent.click(screen.getByText('All mounts'));
    expect(setTweak).toHaveBeenCalledWith('activeMount', 'all');
  });

  it('mount row is active when ctx.tweaks.activeMount matches', () => {
    wrap({ tweaks: { activeMount: 'all' }, setTweak: vi.fn() });
    const allBtn = screen.getByText('All mounts').closest('button');
    expect(allBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('Overview nav item is active when pathname is /mimir', () => {
    wrap();
    const overviewBtn = screen.getByText('Overview').closest('button');
    expect(overviewBtn).toHaveAttribute('aria-current', 'page');
  });
});
