import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from './ConfigProvider';
import { FeatureCatalogProvider, useFeatureCatalog } from './FeatureCatalog';
import type { IFeatureCatalogService, FeatureModule } from './ports/feature-catalog.port';

function Reader({ id }: { id: string }) {
  const { isEnabled, order } = useFeatureCatalog();
  return (
    <span data-testid="out">
      {String(isEnabled(id))}-{order(id)}
    </span>
  );
}

describe('FeatureCatalog', () => {
  it('reads enabled + order from config', () => {
    render(
      <ConfigProvider
        value={{
          theme: 'ice',
          plugins: {
            tyr: { enabled: true, order: 4 },
            mimir: { enabled: false, order: 2 },
          },
          services: {},
        }}
      >
        <FeatureCatalogProvider>
          <Reader id="tyr" />
        </FeatureCatalogProvider>
      </ConfigProvider>,
    );
    expect(screen.getByTestId('out').textContent).toBe('true-4');
  });

  it('defaults order to 100 and enabled to true when plugin is absent', () => {
    render(
      <ConfigProvider value={{ theme: 'ice', plugins: {}, services: {} }}>
        <FeatureCatalogProvider>
          <Reader id="missing" />
        </FeatureCatalogProvider>
      </ConfigProvider>,
    );
    expect(screen.getByTestId('out').textContent).toBe('true-100');
  });

  it('respects overrides', () => {
    render(
      <ConfigProvider value={{ theme: 'ice', plugins: {}, services: {} }}>
        <FeatureCatalogProvider overrides={{ isEnabled: () => false, order: () => 42 }}>
          <Reader id="anything" />
        </FeatureCatalogProvider>
      </ConfigProvider>,
    );
    expect(screen.getByTestId('out').textContent).toBe('false-42');
  });

  it('throws when used outside the provider', () => {
    const error = console.error;
    console.error = () => {};
    expect(() =>
      render(
        <ConfigProvider value={{ theme: 'ice', plugins: {}, services: {} }}>
          <Reader id="x" />
        </ConfigProvider>,
      ),
    ).toThrow(/FeatureCatalogProvider/);
    console.error = error;
  });

  describe('with IFeatureCatalogService', () => {
    function createMockService(modules: FeatureModule[]): IFeatureCatalogService {
      return {
        getFeatureModules: vi.fn().mockResolvedValue(modules),
        getUserFeaturePreferences: vi.fn().mockResolvedValue([]),
        updateUserFeaturePreferences: vi.fn().mockResolvedValue([]),
        toggleFeature: vi.fn(),
      };
    }

    it('delegates to service when provided', async () => {
      const service = createMockService([
        {
          key: 'tyr',
          label: 'Tyr',
          icon: 'T',
          scope: 'user',
          enabled: false,
          defaultEnabled: true,
          adminOnly: false,
          order: 7,
        },
      ]);

      render(
        <ConfigProvider
          value={{
            theme: 'ice',
            plugins: { tyr: { enabled: true, order: 4 } },
            services: {},
          }}
        >
          <FeatureCatalogProvider service={service}>
            <Reader id="tyr" />
          </FeatureCatalogProvider>
        </ConfigProvider>,
      );

      // Initially shows config values
      expect(screen.getByTestId('out').textContent).toBe('true-4');

      // After service resolves, shows service values
      await waitFor(() => {
        expect(screen.getByTestId('out').textContent).toBe('false-7');
      });
    });

    it('falls back to config when service errors', async () => {
      const service: IFeatureCatalogService = {
        getFeatureModules: vi.fn().mockRejectedValue(new Error('network')),
        getUserFeaturePreferences: vi.fn(),
        updateUserFeaturePreferences: vi.fn(),
        toggleFeature: vi.fn(),
      };

      render(
        <ConfigProvider
          value={{
            theme: 'ice',
            plugins: { tyr: { enabled: true, order: 3 } },
            services: {},
          }}
        >
          <FeatureCatalogProvider service={service}>
            <Reader id="tyr" />
          </FeatureCatalogProvider>
        </ConfigProvider>,
      );

      // Should remain on config values after error
      await waitFor(() => {
        expect(service.getFeatureModules).toHaveBeenCalled();
      });
      expect(screen.getByTestId('out').textContent).toBe('true-3');
    });

    it('falls back to config for plugins not returned by service', async () => {
      const service = createMockService([
        {
          key: 'tyr',
          label: 'Tyr',
          icon: 'T',
          scope: 'user',
          enabled: true,
          defaultEnabled: true,
          adminOnly: false,
          order: 5,
        },
      ]);

      render(
        <ConfigProvider
          value={{
            theme: 'ice',
            plugins: { mimir: { enabled: false, order: 2 } },
            services: {},
          }}
        >
          <FeatureCatalogProvider service={service}>
            <Reader id="mimir" />
          </FeatureCatalogProvider>
        </ConfigProvider>,
      );

      await waitFor(() => {
        expect(service.getFeatureModules).toHaveBeenCalled();
      });
      // mimir not in service data, falls back to config
      expect(screen.getByTestId('out').textContent).toBe('false-2');
    });

    it('overrides take precedence over service', async () => {
      const service = createMockService([
        {
          key: 'tyr',
          label: 'Tyr',
          icon: 'T',
          scope: 'user',
          enabled: true,
          defaultEnabled: true,
          adminOnly: false,
          order: 5,
        },
      ]);

      render(
        <ConfigProvider value={{ theme: 'ice', plugins: {}, services: {} }}>
          <FeatureCatalogProvider
            service={service}
            overrides={{ isEnabled: () => false, order: () => 99 }}
          >
            <Reader id="tyr" />
          </FeatureCatalogProvider>
        </ConfigProvider>,
      );

      await waitFor(() => {
        expect(service.getFeatureModules).toHaveBeenCalled();
      });
      expect(screen.getByTestId('out').textContent).toBe('false-99');
    });
  });
});
