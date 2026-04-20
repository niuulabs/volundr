/**
 * capture-baselines.ts — one-time script to screenshot every view in the web2
 * prototypes and save them as committed references under
 * `e2e/__screenshots__/web2/{plugin}/{view}.png`.
 *
 * Run once (or after a prototype update) to regenerate the reference images:
 *
 *   cd web-next
 *   pnpm capture-baselines
 *
 * The screenshots are committed so that reviewers can visually diff web-next
 * against the originals in the Playwright HTML report (`e2e/visual/` specs load
 * these paths as their "expected" reference in failure diffs).
 *
 * This file is intentionally NOT named *.spec.ts so it is excluded from the
 * standard `pnpm test:e2e` run. Run it explicitly via `pnpm capture-baselines`.
 */

import { test, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── Helpers ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB2_ROOT = path.resolve(__dirname, '../../../web2/niuu_handoff');
const OUT_ROOT = path.resolve(__dirname, '__screenshots__/web2');

function outPath(plugin: string, view: string): string {
  const dir = path.join(OUT_ROOT, plugin);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${view}.png`);
}

function fileUrl(relativePath: string): string {
  return `file://${path.join(WEB2_ROOT, relativePath)}`;
}

/** Wait for React + Babel transpilation to complete and first paint to settle. */
async function waitForReady(page: Page): Promise<void> {
  // Babel-in-browser defers compilation; wait for the root to have children.
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return root !== null && root.children.length > 0;
  }, { timeout: 15_000 });
  // Let any rAF-driven animations reach steady state.
  await page.waitForTimeout(600);
}

/** Click a tab button by its visible label text. */
async function clickTab(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.waitForTimeout(400);
}

// ── Observatory ────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — observatory', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

  test('canvas view', async ({ page }) => {
    await page.goto(fileUrl('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('observatory', 'canvas'), fullPage: true });
  });

  test('registry — types tab', async ({ page }) => {
    await page.goto(fileUrl('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Registry/i }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: outPath('observatory', 'registry-types'), fullPage: true });
  });

  test('registry — containment tab', async ({ page }) => {
    await page.goto(fileUrl('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Registry/i }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Containment/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('observatory', 'registry-containment'), fullPage: true });
  });

  test('registry — json tab', async ({ page }) => {
    await page.goto(fileUrl('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Registry/i }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /JSON/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('observatory', 'registry-json'), fullPage: true });
  });
});

// ── Ravn ───────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — ravn', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

  test('overview', async ({ page }) => {
    await page.goto(fileUrl('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Overview');
    await page.screenshot({ path: outPath('ravn', 'overview'), fullPage: true });
  });

  test('ravens — split view', async ({ page }) => {
    await page.goto(fileUrl('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Ravens');
    await page.screenshot({ path: outPath('ravn', 'ravens-split'), fullPage: true });
  });

  test('personas', async ({ page }) => {
    await page.goto(fileUrl('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Personas');
    await page.screenshot({ path: outPath('ravn', 'personas'), fullPage: true });
  });

  test('sessions', async ({ page }) => {
    await page.goto(fileUrl('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Sessions');
    await page.screenshot({ path: outPath('ravn', 'sessions'), fullPage: true });
  });

  test('budget', async ({ page }) => {
    await page.goto(fileUrl('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Budget');
    await page.screenshot({ path: outPath('ravn', 'budget'), fullPage: true });
  });
});

// ── Tyr ────────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — tyr', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

  test('dashboard', async ({ page }) => {
    await page.goto(fileUrl('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Dashboard');
    await page.screenshot({ path: outPath('tyr', 'dashboard'), fullPage: true });
  });

  test('sagas', async ({ page }) => {
    await page.goto(fileUrl('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Sagas');
    await page.screenshot({ path: outPath('tyr', 'sagas'), fullPage: true });
  });

  test('workflows', async ({ page }) => {
    await page.goto(fileUrl('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Workflows');
    await page.screenshot({ path: outPath('tyr', 'workflows'), fullPage: true });
  });

  test('plan', async ({ page }) => {
    await page.goto(fileUrl('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Plan');
    await page.screenshot({ path: outPath('tyr', 'plan'), fullPage: true });
  });

  test('dispatch', async ({ page }) => {
    await page.goto(fileUrl('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Dispatch');
    await page.screenshot({ path: outPath('tyr', 'dispatch'), fullPage: true });
  });

  test('settings', async ({ page }) => {
    await page.goto(fileUrl('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Settings/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('tyr', 'settings'), fullPage: true });
  });
});

// ── Mimir ──────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — mimir', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

  test('home', async ({ page }) => {
    await page.goto(fileUrl('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('mimir', 'home'), fullPage: true });
  });

  test('pages — tree', async ({ page }) => {
    await page.goto(fileUrl('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Pages/i }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: outPath('mimir', 'pages-tree'), fullPage: true });
  });

  test('search', async ({ page }) => {
    await page.goto(fileUrl('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Search/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'search'), fullPage: true });
  });

  test('graph', async ({ page }) => {
    await page.goto(fileUrl('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Graph/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'graph'), fullPage: true });
  });

  test('lint', async ({ page }) => {
    await page.goto(fileUrl('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Lint/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'lint'), fullPage: true });
  });

  test('ingest', async ({ page }) => {
    await page.goto(fileUrl('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Ingest/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'ingest'), fullPage: true });
  });

  test('log', async ({ page }) => {
    await page.goto(fileUrl('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Log/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'log'), fullPage: true });
  });
});

// ── Volundr ────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — volundr', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

  test('forge overview', async ({ page }) => {
    await page.goto(fileUrl('volundr/design/Volundr.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('volundr', 'forge-overview'), fullPage: true });
  });

  test('templates', async ({ page }) => {
    await page.goto(fileUrl('volundr/design/Volundr.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Templates/i }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: outPath('volundr', 'templates'), fullPage: true });
  });

  test('clusters', async ({ page }) => {
    await page.goto(fileUrl('volundr/design/Volundr.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Clusters/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('volundr', 'clusters'), fullPage: true });
  });

  test('sessions', async ({ page }) => {
    await page.goto(fileUrl('volundr/design/Volundr.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Sessions/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('volundr', 'sessions'), fullPage: true });
  });
});

// ── Login ──────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — login', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

  test('login page', async ({ page }) => {
    await page.goto(fileUrl('niuu_login/design/Niuu Login.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('login', 'login-page'), fullPage: true });
  });
});
