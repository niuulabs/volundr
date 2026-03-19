import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        'src/main.tsx',
        'src/plugin.ts',
        'src/vite-env.d.ts',
        '**/*.d.ts',
        '**/*.config.*',
        '**/index.ts',
        'src/adapters/api/yggdrasil.adapter.ts',
      ],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `vscode` is provided at runtime by the VS Code extension host.
      // In tests it's mocked via vi.mock('vscode') in setup.ts, but Vite's
      // import analysis still needs a resolvable path.
      vscode: path.resolve(__dirname, './src/test/__mocks__/vscode.ts'),
    },
  },
});
