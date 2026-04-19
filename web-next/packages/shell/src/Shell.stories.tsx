import type { Meta, StoryObj } from '@storybook/react';
import { createRoute, createMemoryHistory } from '@tanstack/react-router';
import { ConfigProvider, FeatureCatalogProvider, definePlugin } from '@niuulabs/plugin-sdk';
import { Rune } from '@niuulabs/ui';
import { Shell } from './Shell';
import './Shell.css';

const alphaPlugin = definePlugin({
  id: 'alpha',
  rune: 'ᚨ',
  title: 'Alpha',
  subtitle: 'first plugin',
  routes: (root) => [
    createRoute({
      getParentRoute: () => root,
      path: '/alpha',
      component: () => (
        <div style={{ padding: 'var(--space-6)' }}>
          <h2>Alpha Plugin</h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>This is the Alpha plugin content.</p>
        </div>
      ),
    }),
  ],
});

const betaPlugin = definePlugin({
  id: 'beta',
  rune: 'ᛒ',
  title: 'Beta',
  subtitle: 'second plugin',
  subnav: () => (
    <div style={{ padding: 'var(--space-3)' }}>
      <strong style={{ color: 'var(--color-text-secondary)' }}>Subnav</strong>
    </div>
  ),
  topbarRight: () => <Rune glyph="ᛒ" size={16} muted />,
  routes: (root) => [
    createRoute({
      getParentRoute: () => root,
      path: '/beta',
      component: () => (
        <div style={{ padding: 'var(--space-6)' }}>
          <h2>Beta Plugin</h2>
          <p style={{ color: 'var(--color-text-secondary)' }}>
            This plugin demonstrates subnav and topbarRight.
          </p>
        </div>
      ),
    }),
  ],
});

const mockPlugins = [alphaPlugin, betaPlugin];

const meta: Meta<typeof Shell> = {
  title: 'Shell/Shell',
  component: Shell,
  decorators: [
    (Story) => (
      <ConfigProvider value={{ theme: 'ice', plugins: {}, services: {} }}>
        <FeatureCatalogProvider>
          <Story />
        </FeatureCatalogProvider>
      </ConfigProvider>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
  },
};
export default meta;

type Story = StoryObj<typeof Shell>;

export const Default: Story = {
  args: {
    plugins: mockPlugins,
    history: createMemoryHistory({ initialEntries: ['/alpha'] }),
  },
};

export const WithSubnav: Story = {
  args: {
    plugins: mockPlugins,
    history: createMemoryHistory({ initialEntries: ['/beta'] }),
  },
};

export const NotFoundPage: Story = {
  args: {
    plugins: mockPlugins,
    history: createMemoryHistory({ initialEntries: ['/unknown-path'] }),
  },
};
