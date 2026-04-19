import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@niuulabs/auth': resolve(__dirname, 'packages/auth/src/index.ts'),
      '@niuulabs/design-tokens': resolve(__dirname, 'packages/design-tokens/src/index.ts'),
      '@niuulabs/domain': resolve(__dirname, 'packages/domain/src/index.ts'),
      '@niuulabs/plugin-hello': resolve(__dirname, 'packages/plugin-hello/src/index.tsx'),
      '@niuulabs/plugin-sdk': resolve(__dirname, 'packages/plugin-sdk/src/index.ts'),
      '@niuulabs/query': resolve(__dirname, 'packages/query/src/index.ts'),
      '@niuulabs/shell': resolve(__dirname, 'packages/shell/src/index.ts'),
      '@niuulabs/ui': resolve(__dirname, 'packages/ui/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['packages/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.stories.tsx',
        '**/*.test.{ts,tsx}',
        '**/index.{ts,tsx}',
        '**/ports.ts',
        '**/*.d.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
});
