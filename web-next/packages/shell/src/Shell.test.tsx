import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { createRoute, createMemoryHistory } from '@tanstack/react-router';
import { ConfigProvider, FeatureCatalogProvider, definePlugin } from '@niuulabs/plugin-sdk';
import { Shell } from './Shell';

const pluginA = definePlugin({
  id: 'alpha',
  rune: 'ᚨ',
  title: 'Alpha',
  subtitle: 'first',
  routes: (root) => [
    createRoute({
      getParentRoute: () => root,
      path: '/alpha',
      component: () => <div data-testid="alpha-content">alpha-rendered</div>,
    }),
  ],
});

const pluginB = definePlugin({
  id: 'beta',
  rune: 'ᛒ',
  title: 'Beta',
  subtitle: 'second',
  routes: (root) => [
    createRoute({
      getParentRoute: () => root,
      path: '/beta',
      component: () => <div data-testid="beta-content">beta-rendered</div>,
    }),
  ],
});

function wrap(
  ui: React.ReactNode,
  pluginOverrides: Record<string, { enabled: boolean; order: number }> = {},
) {
  return render(
    <ConfigProvider
      value={{
        theme: 'ice',
        plugins: pluginOverrides,
        services: {},
      }}
    >
      <FeatureCatalogProvider>{ui}</FeatureCatalogProvider>
    </ConfigProvider>,
  );
}

describe('Shell', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders the first enabled plugin by default', async () => {
    wrap(
      <Shell
        plugins={[pluginA, pluginB]}
        history={createMemoryHistory({ initialEntries: ['/alpha'] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('alpha-content')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('beta-content')).not.toBeInTheDocument();
  });

  it('switches active plugin on rail click and persists to localStorage', async () => {
    wrap(
      <Shell
        plugins={[pluginA, pluginB]}
        history={createMemoryHistory({ initialEntries: ['/alpha'] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('alpha-content')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTitle('Beta · second'));
    await waitFor(() => {
      expect(screen.getByTestId('beta-content')).toBeInTheDocument();
    });
    expect(localStorage.getItem('niuu.active')).toBe('beta');
  });

  it('hides plugins disabled via config', async () => {
    wrap(
      <Shell
        plugins={[pluginA, pluginB]}
        history={createMemoryHistory({ initialEntries: ['/beta'] })}
      />,
      {
        alpha: { enabled: false, order: 1 },
      },
    );
    await waitFor(() => {
      expect(screen.getByTestId('beta-content')).toBeInTheDocument();
    });
    expect(screen.queryByTitle('Alpha · first')).not.toBeInTheDocument();
  });

  it('renders 404 for unknown paths', async () => {
    wrap(
      <Shell
        plugins={[pluginA]}
        history={createMemoryHistory({ initialEntries: ['/nonexistent'] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('404')).toBeInTheDocument();
    });
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });

  it('redirects / to the first plugin', async () => {
    wrap(
      <Shell
        plugins={[pluginA, pluginB]}
        history={createMemoryHistory({ initialEntries: ['/'] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('alpha-content')).toBeInTheDocument();
    });
  });

  it('syncs localStorage from router state', async () => {
    wrap(
      <Shell
        plugins={[pluginA, pluginB]}
        history={createMemoryHistory({ initialEntries: ['/beta'] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('beta-content')).toBeInTheDocument();
    });
    expect(localStorage.getItem('niuu.active')).toBe('beta');
  });

  it('renders subnav when plugin provides one', async () => {
    const pluginWithSubnav = definePlugin({
      id: 'sub',
      rune: 'ᛊ',
      title: 'Sub',
      subtitle: 'subnav test',
      subnav: () => <div data-testid="subnav-content">subnav</div>,
      routes: (root) => [
        createRoute({
          getParentRoute: () => root,
          path: '/sub',
          component: () => <div data-testid="sub-content">sub-rendered</div>,
        }),
      ],
    });
    wrap(
      <Shell
        plugins={[pluginWithSubnav]}
        history={createMemoryHistory({ initialEntries: ['/sub'] })}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('subnav-content')).toBeInTheDocument();
    });
  });

  it('renders with no plugins', async () => {
    wrap(<Shell plugins={[]} history={createMemoryHistory({ initialEntries: ['/'] })} />);
    await waitFor(() => {
      expect(screen.getByText('0 plugins loaded')).toBeInTheDocument();
    });
  });
});
