import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Exclude the baseline capture script from the normal test run.
  // Run it explicitly with `pnpm capture-baselines`.
  testIgnore: [/capture-baselines/],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Generate missing snapshots on first run; compare on subsequent runs.
  // Developers run `--update-snapshots` locally to refresh committed baselines.
  updateSnapshots: 'missing',
  reporter: [['html', { open: 'on-failure' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Standardise viewport for deterministic visual comparisons.
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark',
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter @niuulabs/niuu dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
