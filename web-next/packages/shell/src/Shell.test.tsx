import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ConfigProvider, FeatureCatalogProvider, definePlugin } from '@niuulabs/plugin-sdk';
import { Shell } from './Shell';

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

describe('Shell', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('renders the first enabled plugin by default', () => {
    wrap(<Shell plugins={[pluginA, pluginB]} />);
    expect(screen.getByTestId('alpha-content')).toBeInTheDocument();
    expect(screen.queryByTestId('beta-content')).not.toBeInTheDocument();
  });

  it('switches active plugin on rail click and persists to localStorage', () => {
    wrap(<Shell plugins={[pluginA, pluginB]} />);
    fireEvent.click(screen.getByTitle('Beta · second'));
    expect(screen.getByTestId('beta-content')).toBeInTheDocument();
    expect(localStorage.getItem('niuu.active')).toBe('beta');
  });

  it('hides plugins disabled via config', () => {
    wrap(<Shell plugins={[pluginA, pluginB]} />, {
      alpha: { enabled: false, order: 1 },
    });
    expect(screen.queryByTitle('Alpha · first')).not.toBeInTheDocument();
    expect(screen.getByTestId('beta-content')).toBeInTheDocument();
  });
});
