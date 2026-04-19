import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { createMemoryHistory } from '@tanstack/react-router';
import { ConfigProvider, FeatureCatalogProvider, definePlugin } from '@niuulabs/plugin-sdk';
import { Shell } from './Shell';

// Plugins that use render() (no routes) — cover the render-fallback path.
const pluginA = definePlugin({
  id: 'alpha',
  rune: 'ᚨ',
  title: 'Alpha',
  subtitle: 'first',
  render: () => <div data-testid="alpha-content">alpha-rendered</div>,
});

const pluginB = definePlugin({
  id: 'beta',
  rune: 'ᛒ',
  title: 'Beta',
  subtitle: 'second',
  render: () => <div data-testid="beta-content">beta-rendered</div>,
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

/** A memory history pre-navigated to a path — keeps test runs isolated. */
function memHistory(path: string) {
  return createMemoryHistory({ initialEntries: [path] });
}

describe('Shell', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders the first enabled plugin by default', async () => {
    wrap(<Shell plugins={[pluginA, pluginB]} _testHistory={memHistory('/')} />);
    // Index route redirects to /alpha (first enabled plugin)
    await waitFor(() => {
      expect(screen.getByTestId('alpha-content')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('beta-content')).not.toBeInTheDocument();
  });

  it('renders a plugin directly when memory history starts at its path', async () => {
    wrap(<Shell plugins={[pluginA, pluginB]} _testHistory={memHistory('/beta')} />);
    await waitFor(() => {
      expect(screen.getByTestId('beta-content')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('alpha-content')).not.toBeInTheDocument();
  });

  it('switches active plugin on rail click and persists to localStorage', async () => {
    wrap(<Shell plugins={[pluginA, pluginB]} _testHistory={memHistory('/')} />);
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
    wrap(<Shell plugins={[pluginA, pluginB]} _testHistory={memHistory('/')} />, {
      alpha: { enabled: false, order: 1 },
    });
    await waitFor(() => {
      expect(screen.queryByTitle('Alpha · first')).not.toBeInTheDocument();
      expect(screen.getByTestId('beta-content')).toBeInTheDocument();
    });
  });

  it('localStorage.niuu.active is written from the router state, not vice-versa', async () => {
    wrap(<Shell plugins={[pluginA, pluginB]} _testHistory={memHistory('/beta')} />);
    await waitFor(() => {
      expect(screen.getByTestId('beta-content')).toBeInTheDocument();
    });
    // localStorage should have been updated from the route, not from a stored value
    expect(localStorage.getItem('niuu.active')).toBe('beta');
  });
});
