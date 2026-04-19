import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigProvider } from './ConfigProvider';
import { FeatureCatalogProvider, useFeatureCatalog } from './FeatureCatalog';

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
});
