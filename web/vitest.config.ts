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
        '**/*.module.css',
        '**/index.ts',
        '**/register.ts',
        'src/modules/icons.ts',
        'src/modules/registry.ts',
        'src/adapters/api/yggdrasil.adapter.ts',
        // New Tyr dashboard UI components — will be tested in follow-up
        'src/modules/tyr/components/RaidsTable/**',
        'src/modules/tyr/components/RaidExpandedRow/**',
        'src/modules/tyr/components/ReviewPanel/**',
        'src/modules/tyr/components/RaidTimeline/**',
        'src/modules/tyr/components/FeedbackChat/**',
        'src/modules/tyr/components/DashboardTopBar/**',
        'src/modules/tyr/components/AttentionBar/**',
        'src/modules/tyr/components/SagasSidebar/**',
        'src/modules/tyr/components/SystemsHealth/**',
        'src/modules/tyr/components/MilestoneRow/**',
        'src/modules/tyr/components/TrackerIssueRow/**',
        'src/modules/tyr/pages/DashboardView/**',
        'src/modules/tyr/pages/ImportView/**',
        // Volundr API adapter — integration layer, tested via adapter tests
        'src/modules/volundr/adapters/api/volundr.adapter.ts',
        // Mock adapters — test doubles, not production code
        'src/modules/tyr/adapters/mock/**',
        // Tyr tracker API adapter — integration layer
        'src/modules/tyr/adapters/api/tracker.ts',
        // Port interface — no executable logic
        'src/modules/shared/ports/**',
      ],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
  define: {
    '__APP_VERSION__': JSON.stringify('test'),
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
