/**
 * capture-baselines.spec.ts — one-time script to screenshot every view in the web2
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
 * This file is excluded from the standard `pnpm test:e2e` run via testIgnore in
 * playwright.config.ts. Run it explicitly via `pnpm capture-baselines`.
 */

import { test, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

// ── Helpers ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB2_ROOT = path.resolve(__dirname, '../../web2/niuu_handoff');
const OUT_ROOT = path.resolve(__dirname, '__screenshots__/web2');

// Serve web2 prototypes over HTTP so Babel's XHR-based JSX loading works
// (file:// triggers CORS blocks on external script src attributes).
let web2Server: http.Server | undefined;
let web2Port: number;

test.beforeAll(async () => {
  web2Server = http.createServer((req, res) => {
    // Strip query strings (e.g. styles.css?v=4) before resolving file paths.
    const raw = decodeURIComponent(req.url || '/');
    const url = raw.split('?')[0];
    const filePath = path.join(WEB2_ROOT, url);
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.jsx': 'application/javascript',
      '.json': 'application/json',
      '.ttf': 'font/ttf',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    };
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise<void>((resolve) => {
    web2Server!.listen(0, () => {
      web2Port = (web2Server!.address() as { port: number }).port;
      resolve();
    });
  });
});

test.afterAll(async () => {
  web2Server?.close();
});

function outPath(plugin: string, view: string): string {
  const dir = path.join(OUT_ROOT, plugin);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${view}.png`);
}

function web2Url(relativePath: string): string {
  return `http://localhost:${web2Port}/${relativePath}`;
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

/** Click a tab or subnav button by its visible label text (partial match). */
async function clickTab(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(label, 'i') }).first().click();
  await page.waitForTimeout(400);
}

/** Click a rail icon whose title contains the given substring. */
async function clickRail(page: Page, titleSubstring: string): Promise<void> {
  await page.click(`button.rail-item[title*="${titleSubstring}"]`);
  await page.waitForTimeout(400);
}

// Single viewport/colorScheme applies to all describe blocks below.
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

// ── Observatory ────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — observatory', () => {
  test('canvas view', async ({ page }) => {
    await page.goto(web2Url('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('observatory', 'canvas'), fullPage: false });
  });

  test('registry — types tab', async ({ page }) => {
    await page.goto(web2Url('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await clickRail(page, 'Registry');
    await page.screenshot({ path: outPath('observatory', 'registry-types'), fullPage: false });
  });

  test('registry — containment tab', async ({ page }) => {
    await page.goto(web2Url('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await clickRail(page, 'Registry');
    await clickTab(page, 'Containment');
    await page.screenshot({ path: outPath('observatory', 'registry-containment'), fullPage: false });
  });

  test('registry — json tab', async ({ page }) => {
    await page.goto(web2Url('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await clickRail(page, 'Registry');
    await clickTab(page, 'JSON');
    await page.screenshot({ path: outPath('observatory', 'registry-json'), fullPage: false });
  });
});

// ── Ravn ───────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — ravn', () => {
  test('overview', async ({ page }) => {
    await page.goto(web2Url('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Overview');
    await page.screenshot({ path: outPath('ravn', 'overview'), fullPage: false });
  });

  test('ravens — split view', async ({ page }) => {
    await page.goto(web2Url('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Ravens');
    await page.screenshot({ path: outPath('ravn', 'ravens-split'), fullPage: false });
  });

  test('personas', async ({ page }) => {
    await page.goto(web2Url('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Personas');
    await page.screenshot({ path: outPath('ravn', 'personas'), fullPage: false });
  });

  test('sessions', async ({ page }) => {
    await page.goto(web2Url('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Sessions');
    await page.screenshot({ path: outPath('ravn', 'sessions'), fullPage: false });
  });

  test('budget', async ({ page }) => {
    await page.goto(web2Url('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Budget');
    await page.screenshot({ path: outPath('ravn', 'budget'), fullPage: false });
  });
});

// ── Tyr ────────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — tyr', () => {
  test('dashboard', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Dashboard');
    await page.screenshot({ path: outPath('tyr', 'dashboard'), fullPage: false });
  });

  test('sagas', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Sagas');
    await page.screenshot({ path: outPath('tyr', 'sagas'), fullPage: false });
  });

  test('workflows', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Workflows');
    await page.screenshot({ path: outPath('tyr', 'workflows'), fullPage: false });
  });

  test('plan', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Plan');
    await page.screenshot({ path: outPath('tyr', 'plan'), fullPage: false });
  });

  test('dispatch', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Dispatch');
    await page.screenshot({ path: outPath('tyr', 'dispatch'), fullPage: false });
  });

  test('settings', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickRail(page, 'Settings');
    await page.screenshot({ path: outPath('tyr', 'settings'), fullPage: false });
  });
});

// ── Mimir ──────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — mimir', () => {
  /** Navigate to Mimir prototype and activate the Mimir plugin in the shell. */
  async function gotoMimir(page: Page): Promise<void> {
    await page.goto(web2Url('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    // The Flokk shell defaults to Observatory. Click the Mímir rail icon.
    await clickRail(page, 'mir');
    // Wait for the subnav to appear
    await page.waitForSelector('button.mm-subnav-btn', { timeout: 5_000 });
  }

  test('home', async ({ page }) => {
    await gotoMimir(page);
    await page.screenshot({ path: outPath('mimir', 'home'), fullPage: false });
  });

  test('pages — tree', async ({ page }) => {
    await gotoMimir(page);
    await page.click('button.mm-subnav-btn:has-text("Pages")');
    await page.waitForTimeout(400);
    await page.screenshot({ path: outPath('mimir', 'pages-tree'), fullPage: false });
  });

  test('search', async ({ page }) => {
    await gotoMimir(page);
    await page.click('button.mm-subnav-btn:has-text("Search")');
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'search'), fullPage: false });
  });

  test('graph', async ({ page }) => {
    await gotoMimir(page);
    await page.click('button.mm-subnav-btn:has-text("Graph")');
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'graph'), fullPage: false });
  });

  test('ravns', async ({ page }) => {
    await gotoMimir(page);
    await page.click('button.mm-subnav-btn:has-text("Wardens")');
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'ravns'), fullPage: false });
  });

  test('lint', async ({ page }) => {
    await gotoMimir(page);
    await page.click('button.mm-subnav-btn:has-text("Lint")');
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'lint'), fullPage: false });
  });

  test('ingest', async ({ page }) => {
    await gotoMimir(page);
    await page.click('button.mm-subnav-btn:has-text("Ingest")');
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'ingest'), fullPage: false });
  });

  test('log', async ({ page }) => {
    await gotoMimir(page);
    await page.click('button.mm-subnav-btn:has-text("Log")');
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('mimir', 'log'), fullPage: false });
  });
});

// ── Volundr ────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — volundr', () => {
  test('forge overview', async ({ page }) => {
    await page.goto(web2Url('volundr/design/Volundr.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('volundr', 'forge-overview'), fullPage: false });
  });

  test('templates', async ({ page }) => {
    await page.goto(web2Url('volundr/design/Volundr.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Templates/i }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: outPath('volundr', 'templates'), fullPage: false });
  });

  test('clusters', async ({ page }) => {
    await page.goto(web2Url('volundr/design/Volundr.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Clusters/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('volundr', 'clusters'), fullPage: false });
  });

  test('sessions', async ({ page }) => {
    await page.goto(web2Url('volundr/design/Volundr.html'));
    await waitForReady(page);
    await page.getByRole('button', { name: /Sessions/i }).first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: outPath('volundr', 'sessions'), fullPage: false });
  });
});

// ── Login ──────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — login', () => {
  test('login page', async ({ page }) => {
    await page.goto(web2Url('niuu_login/design/Niuu Login.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('login', 'login-page'), fullPage: false });
  });
});
