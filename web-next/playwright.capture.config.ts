/**
 * Playwright config for the capture-baselines script only.
 *
 * Separate from the main config because:
 * 1. capture-baselines is excluded by testIgnore in the main config
 * 2. It doesn't need the web-next dev server (it spins up its own HTTP server
 *    for the web2 prototypes)
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark',
      },
    },
  ],
});
