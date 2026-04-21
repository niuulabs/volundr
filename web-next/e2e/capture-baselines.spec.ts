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

// Serve web2 prototypes over HTTP so CDN scripts (React, Babel) load normally.
let server: http.Server;
let serverPort: number;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.jsx': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/**
 * For HTML files: inline all `<script type="text/babel" src="...">` tags so
 * Babel standalone doesn't need to fetch them via synchronous XHR (which
 * Chromium headless blocks).
 */
function inlineBabelScripts(htmlPath: string): string {
  const dir = path.dirname(htmlPath);
  let html = fs.readFileSync(htmlPath, 'utf-8');
  // Match <script type="text/babel" src="file.jsx"></script>
  html = html.replace(
    /<script\s+type="text\/babel"\s+src="([^"]+)"\s*><\/script>/g,
    (_match, src: string) => {
      const srcPath = path.join(dir, src);
      if (!fs.existsSync(srcPath)) return `<!-- missing: ${src} -->`;
      const content = fs.readFileSync(srcPath, 'utf-8');
      return `<script type="text/babel">\n${content}\n</script>`;
    },
  );
  return html;
}

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '/');
    const filePath = path.join(WEB2_ROOT, url);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    // Inline external Babel scripts so headless Chromium doesn't block them.
    if (ext === '.html') {
      const html = inlineBabelScripts(filePath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      serverPort = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function outPath(plugin: string, view: string): string {
  const dir = path.join(OUT_ROOT, plugin);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${view}.png`);
}

function web2Url(relativePath: string): string {
  return `http://localhost:${serverPort}/${relativePath}`;
}

/** Wait for React + Babel transpilation to complete and first paint to settle. */
async function waitForReady(page: Page): Promise<void> {
  // Babel compiles scripts sequentially. The shell renders first, then plugins.
  // Wait until button elements appear (tabs or subnav), which means the full
  // app has mounted — not just the shell chrome.
  await page.waitForFunction(
    () => document.querySelectorAll('#root button').length >= 3,
    { timeout: 10_000 },
  );
  // Let any rAF-driven animations reach steady state.
  await page.waitForTimeout(600);
}

/**
 * Click a navigation element by label. Web2 prototypes use three patterns:
 *   - Top-bar tabs: button text = "◈ Dashboard" (glyph + label)
 *   - Rail items: button text = "ᛞ" (glyph only), label in title attr
 *   - Subnav buttons: button text = "◎ Overview" (glyph + label, in sidebar)
 * Use CSS selectors with force:true to bypass actionability checks (some
 * subnav buttons are in overflow-scroll containers).
 */
async function clickTab(page: Page, label: string): Promise<void> {
  // Try title attribute first (rail items), then text content (tabs & subnav).
  const byTitle = page.locator(`button[title*="${label}"]`).first();
  if (await byTitle.count() > 0) {
    await byTitle.click({ force: true });
  } else {
    await page.locator(`button:has-text("${label}")`).first().click({ force: true });
  }
  await page.waitForTimeout(400);
}

// Single viewport/colorScheme applies to all describe blocks below.
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

// ── Observatory ────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — observatory', () => {
  test('canvas view', async ({ page }) => {
    await page.goto(web2Url('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('observatory', 'canvas'), fullPage: true });
  });

  test('registry — types tab', async ({ page }) => {
    await page.goto(web2Url('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await clickTab(page, 'Registry');
    await page.waitForTimeout(400);
    await page.screenshot({ path: outPath('observatory', 'registry-types'), fullPage: true });
  });

  test('registry — containment tab', async ({ page }) => {
    await page.goto(web2Url('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await clickTab(page, 'Registry');
    await clickTab(page, 'Containment');
    await page.screenshot({ path: outPath('observatory', 'registry-containment'), fullPage: true });
  });

  test('registry — json tab', async ({ page }) => {
    await page.goto(web2Url('flokk_observatory/design/Flokk Observatory.html'));
    await waitForReady(page);
    await clickTab(page, 'Registry');
    await clickTab(page, 'JSON');
    await page.screenshot({ path: outPath('observatory', 'registry-json'), fullPage: true });
  });
});

// ── Ravn ───────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — ravn', () => {
  test('overview', async ({ page }) => {
    await page.goto(web2Url('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Overview');
    await page.screenshot({ path: outPath('ravn', 'overview'), fullPage: true });
  });

  test('ravens — split view', async ({ page }) => {
    await page.goto(web2Url('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Ravens');
    await page.screenshot({ path: outPath('ravn', 'ravens-split'), fullPage: true });
  });

  test('personas', async ({ page }) => {
    await page.goto(web2Url('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Personas');
    await page.screenshot({ path: outPath('ravn', 'personas'), fullPage: true });
  });

  test('sessions', async ({ page }) => {
    await page.goto(web2Url('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Sessions');
    await page.screenshot({ path: outPath('ravn', 'sessions'), fullPage: true });
  });

  test('budget', async ({ page }) => {
    await page.goto(web2Url('ravn/design/Ravn.html'));
    await waitForReady(page);
    await clickTab(page, 'Budget');
    await page.screenshot({ path: outPath('ravn', 'budget'), fullPage: true });
  });
});

// ── Tyr ────────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — tyr', () => {
  test('dashboard', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Dashboard');
    await page.screenshot({ path: outPath('tyr', 'dashboard'), fullPage: true });
  });

  test('sagas', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Sagas');
    await page.screenshot({ path: outPath('tyr', 'sagas'), fullPage: true });
  });

  test('workflows', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Workflows');
    await page.screenshot({ path: outPath('tyr', 'workflows'), fullPage: true });
  });

  test('plan', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Plan');
    await page.screenshot({ path: outPath('tyr', 'plan'), fullPage: true });
  });

  test('dispatch', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Dispatch');
    await page.screenshot({ path: outPath('tyr', 'dispatch'), fullPage: true });
  });

  test('settings', async ({ page }) => {
    await page.goto(web2Url('tyr/design/Tyr Saga Coordinator.html'));
    await waitForReady(page);
    await clickTab(page, 'Settings');
    await page.screenshot({ path: outPath('tyr', 'settings'), fullPage: true });
  });
});

// ── Mimir ──────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — mimir', () => {
  test('home', async ({ page }) => {
    await page.goto(web2Url('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('mimir', 'home'), fullPage: true });
  });

  test('pages — tree', async ({ page }) => {
    await page.goto(web2Url('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await clickTab(page, 'Pages');
    await page.screenshot({ path: outPath('mimir', 'pages-tree'), fullPage: true });
  });

  test('search', async ({ page }) => {
    await page.goto(web2Url('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await clickTab(page, 'Search');
    await page.screenshot({ path: outPath('mimir', 'search'), fullPage: true });
  });

  test('graph', async ({ page }) => {
    await page.goto(web2Url('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await clickTab(page, 'Graph');
    await page.screenshot({ path: outPath('mimir', 'graph'), fullPage: true });
  });

  test('ravns', async ({ page }) => {
    await page.goto(web2Url('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await clickTab(page, 'Wardens');
    await page.screenshot({ path: outPath('mimir', 'ravns'), fullPage: true });
  });

  test('lint', async ({ page }) => {
    await page.goto(web2Url('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await clickTab(page, 'Lint');
    await page.screenshot({ path: outPath('mimir', 'lint'), fullPage: true });
  });

  test('ingest', async ({ page }) => {
    await page.goto(web2Url('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await clickTab(page, 'Ingest');
    await page.screenshot({ path: outPath('mimir', 'ingest'), fullPage: true });
  });

  test('log', async ({ page }) => {
    await page.goto(web2Url('mimir/design/Flokk Mimir.html'));
    await waitForReady(page);
    await clickTab(page, 'Log');
    await page.screenshot({ path: outPath('mimir', 'log'), fullPage: true });
  });
});

// ── Volundr ────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — volundr', () => {
  test('forge overview', async ({ page }) => {
    await page.goto(web2Url('volundr/design/Volundr.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('volundr', 'forge-overview'), fullPage: true });
  });

  test('templates', async ({ page }) => {
    await page.goto(web2Url('volundr/design/Volundr.html'));
    await waitForReady(page);
    await clickTab(page, 'Templates');
    await page.screenshot({ path: outPath('volundr', 'templates'), fullPage: true });
  });

  test('clusters', async ({ page }) => {
    await page.goto(web2Url('volundr/design/Volundr.html'));
    await waitForReady(page);
    await clickTab(page, 'Clusters');
    await page.screenshot({ path: outPath('volundr', 'clusters'), fullPage: true });
  });

  test('sessions', async ({ page }) => {
    await page.goto(web2Url('volundr/design/Volundr.html'));
    await waitForReady(page);
    await clickTab(page, 'Sessions');
    await page.screenshot({ path: outPath('volundr', 'sessions'), fullPage: true });
  });
});

// ── Login ──────────────────────────────────────────────────────────────────────

test.describe('capture web2 baselines — login', () => {
  test('login page', async ({ page }) => {
    await page.goto(web2Url('niuu_login/design/Niuu Login.html'));
    await waitForReady(page);
    await page.screenshot({ path: outPath('login', 'login-page'), fullPage: true });
  });
});
