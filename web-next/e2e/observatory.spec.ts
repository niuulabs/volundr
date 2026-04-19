import { test, expect } from '@playwright/test';

// ── Navigation ────────────────────────────────────────────────────────────────

test('observatory rail button navigates to /observatory', async ({ page }) => {
  await page.goto('/');

  const railButton = page.getByRole('button', { name: /observatory/i });
  await expect(railButton).toBeVisible();

  await railButton.click();
  await expect(page).toHaveURL(/\/observatory/);
});

// ── Canvas renders ────────────────────────────────────────────────────────────

test('observatory page renders the topology canvas', async ({ page }) => {
  await page.goto('/observatory');
  const canvas = page.getByTestId('topology-canvas');
  await expect(canvas).toBeVisible({ timeout: 5000 });
});

test('observatory page renders camera controls', async ({ page }) => {
  await page.goto('/observatory');
  await expect(page.getByTestId('camera-controls')).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: /zoom in/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /zoom out/i })).toBeVisible();
  await expect(page.getByTestId('camera-reset')).toBeVisible();
});

test('observatory page renders the minimap', async ({ page }) => {
  await page.goto('/observatory');
  await expect(page.getByTestId('minimap-panel')).toBeVisible({ timeout: 5000 });
});

// ── Zoom controls ─────────────────────────────────────────────────────────────

test('zoom in button increases zoom percentage', async ({ page }) => {
  await page.goto('/observatory');
  await page.waitForSelector('[data-testid="zoom-display"]');

  const zoomDisplay = page.getByTestId('zoom-display');
  const before = parseInt((await zoomDisplay.textContent()) ?? '0', 10);

  await page.getByRole('button', { name: /zoom in/i }).click();
  const after = parseInt((await zoomDisplay.textContent()) ?? '0', 10);

  expect(after).toBeGreaterThan(before);
});

test('zoom out button decreases zoom percentage', async ({ page }) => {
  await page.goto('/observatory');
  await page.waitForSelector('[data-testid="zoom-display"]');

  const zoomDisplay = page.getByTestId('zoom-display');
  const before = parseInt((await zoomDisplay.textContent()) ?? '0', 10);

  await page.getByRole('button', { name: /zoom out/i }).click();
  const after = parseInt((await zoomDisplay.textContent()) ?? '0', 10);

  expect(after).toBeLessThan(before);
});

test('zoom cannot exceed 300%', async ({ page }) => {
  await page.goto('/observatory');
  await page.waitForSelector('[data-testid="zoom-display"]');

  const zoomIn = page.getByRole('button', { name: /zoom in/i });
  for (let i = 0; i < 30; i++) await zoomIn.click();

  const pct = parseInt((await page.getByTestId('zoom-display').textContent()) ?? '0', 10);
  expect(pct).toBeLessThanOrEqual(300);
});

test('zoom cannot fall below 30%', async ({ page }) => {
  await page.goto('/observatory');
  await page.waitForSelector('[data-testid="zoom-display"]');

  const zoomOut = page.getByRole('button', { name: /zoom out/i });
  for (let i = 0; i < 30; i++) await zoomOut.click();

  const pct = parseInt((await page.getByTestId('zoom-display').textContent()) ?? '0', 10);
  expect(pct).toBeGreaterThanOrEqual(30);
});

test('camera reset restores default zoom', async ({ page }) => {
  await page.goto('/observatory');
  await page.waitForSelector('[data-testid="zoom-display"]');

  // Zoom in a few times
  const zoomIn = page.getByRole('button', { name: /zoom in/i });
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();

  // Reset
  await page.getByTestId('camera-reset').click();
  const pct = parseInt((await page.getByTestId('zoom-display').textContent()) ?? '0', 10);

  // Default INITIAL_ZOOM is 0.5 → 50%
  expect(pct).toBe(50);
});

// ── Scroll-wheel zoom ─────────────────────────────────────────────────────────

test('scroll wheel up zooms in on the canvas', async ({ page }) => {
  await page.goto('/observatory');
  const canvas = page.getByTestId('topology-canvas');
  await canvas.waitFor();

  const zoomDisplay = page.getByTestId('zoom-display');
  const before = parseInt((await zoomDisplay.textContent()) ?? '0', 10);

  // Scroll up (negative deltaY) = zoom in
  await canvas.dispatchEvent('wheel', { deltaY: -120, bubbles: true });
  const after = parseInt((await zoomDisplay.textContent()) ?? '0', 10);
  expect(after).toBeGreaterThan(before);
});

test('scroll wheel down zooms out on the canvas', async ({ page }) => {
  await page.goto('/observatory');
  const canvas = page.getByTestId('topology-canvas');
  await canvas.waitFor();

  const zoomDisplay = page.getByTestId('zoom-display');
  const before = parseInt((await zoomDisplay.textContent()) ?? '0', 10);

  // Scroll down (positive deltaY) = zoom out
  await canvas.dispatchEvent('wheel', { deltaY: 120, bubbles: true });
  const after = parseInt((await zoomDisplay.textContent()) ?? '0', 10);
  expect(after).toBeLessThan(before);
});

// ── Drag pan ──────────────────────────────────────────────────────────────────

test('drag pan changes camera position without error', async ({ page }) => {
  await page.goto('/observatory');
  const canvas = page.getByTestId('topology-canvas');
  await canvas.waitFor();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Simulate drag
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy + 50);
  await page.mouse.up();

  // No crash — canvas still visible and zoom display still shows a percentage
  await expect(canvas).toBeVisible();
  const pct = parseInt((await page.getByTestId('zoom-display').textContent()) ?? '0', 10);
  expect(pct).toBeGreaterThan(0);
});

// ── Keyboard pan ──────────────────────────────────────────────────────────────

test('arrow keys pan the canvas when focused', async ({ page }) => {
  await page.goto('/observatory');
  const canvas = page.getByTestId('topology-canvas');
  await canvas.waitFor();

  // Focus the canvas so it receives keyboard events
  await canvas.focus();

  // Press arrow keys — should not throw; canvas stays visible
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');

  await expect(canvas).toBeVisible();
});

// ── Minimap interaction ───────────────────────────────────────────────────────

test('clicking the minimap pans the main camera', async ({ page }) => {
  await page.goto('/observatory');
  const minimap = page.locator('[data-testid="minimap-panel"] canvas');
  await minimap.waitFor();

  const zoomDisplay = page.getByTestId('zoom-display');
  const before = await zoomDisplay.textContent();

  // Click minimap top-left — pans camera to top-left of world
  await minimap.click({ position: { x: 10, y: 10 } });

  // Zoom should be unchanged; page should not crash
  await expect(page.getByTestId('topology-canvas')).toBeVisible();
  expect(await zoomDisplay.textContent()).toBe(before);
});

// ── Registry page (unchanged from scaffold) ───────────────────────────────────

test('registry page renders entity type list', async ({ page }) => {
  await page.goto('/registry');
  await expect(page.getByText('Registry')).toBeVisible();
  await expect(page.getByText('Realm')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Cluster')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Raid')).toBeVisible({ timeout: 5000 });
});
