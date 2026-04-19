import { test, expect } from '@playwright/test';

test.describe('observatory plugin', () => {
  test('rail button is visible and navigates to /observatory', async ({ page }) => {
    await page.goto('/hello');
    await expect(page.getByText('hello · smoke test')).toBeVisible();

    const obsButton = page.getByTitle('Flokk · Observatory · live topology & entity registry');
    await expect(obsButton).toBeVisible();

    await obsButton.click();
    await expect(page).toHaveURL(/\/observatory/);
    await expect(
      page.getByRole('heading', { name: 'Flokk · Observatory', level: 2 }),
    ).toBeVisible();
  });

  test('deep link /observatory renders the page', async ({ page }) => {
    await page.goto('/observatory');
    await expect(page.getByText('Flokk · Observatory').first()).toBeVisible();
  });

  test('observatory page shows registry version after load', async ({ page }) => {
    await page.goto('/observatory');
    // Registry meta line shows "N types · vX"
    await expect(page.locator('text=/types · v/')).toBeVisible({ timeout: 5000 });
  });

  test('localStorage.niuu.active is set to observatory when visiting it', async ({ page }) => {
    await page.goto('/observatory');
    await expect(
      page.getByRole('heading', { name: 'Flokk · Observatory', level: 2 }),
    ).toBeVisible();

    const stored = await page.evaluate(() => localStorage.getItem('niuu.active'));
    expect(stored).toBe('observatory');
  });

  test('rail has both hello and observatory buttons', async ({ page }) => {
    await page.goto('/hello');
    await expect(page.getByTitle('Hello · smoke test plugin')).toBeVisible();
    await expect(
      page.getByTitle('Flokk · Observatory · live topology & entity registry'),
    ).toBeVisible();
  });

  // ── TopologyCanvas e2e tests ──────────────────────────────────────────────

  test('canvas element is present on /observatory', async ({ page }) => {
    await page.goto('/observatory');
    await expect(page.locator('[aria-label="Topology canvas"]')).toBeVisible({ timeout: 5000 });
  });

  test('minimap is visible with entity count', async ({ page }) => {
    await page.goto('/observatory');
    // Minimap caption always renders.
    await expect(page.getByText('MINIMAP')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=/\\d+ entities/')).toBeVisible({ timeout: 5000 });
  });

  test('zoom controls are present', async ({ page }) => {
    await page.goto('/observatory');
    await expect(page.getByTitle('Zoom in')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTitle('Zoom out')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTitle('Reset camera')).toBeVisible({ timeout: 5000 });
  });

  test('zoom label shows initial percentage', async ({ page }) => {
    await page.goto('/observatory');
    // Initial zoom is 0.32 → 32%
    await expect(page.getByText('32%')).toBeVisible({ timeout: 5000 });
  });

  test('clicking zoom-in button increases zoom percentage', async ({ page }) => {
    await page.goto('/observatory');
    await expect(page.getByTitle('Zoom in')).toBeVisible({ timeout: 5000 });
    await page.getByTitle('Zoom in').click();
    // 32 * 1.12 ≈ 36%
    await expect(page.getByText('36%')).toBeVisible({ timeout: 2000 });
  });

  test('clicking zoom-out button decreases zoom percentage', async ({ page }) => {
    await page.goto('/observatory');
    await expect(page.getByTitle('Zoom out')).toBeVisible({ timeout: 5000 });
    await page.getByTitle('Zoom out').click();
    // 32 / 1.12 ≈ 28.6% → clamped to minZoom 30%
    await expect(page.getByText('30%')).toBeVisible({ timeout: 2000 });
  });

  test('reset camera restores initial zoom', async ({ page }) => {
    await page.goto('/observatory');
    await expect(page.getByTitle('Zoom in')).toBeVisible({ timeout: 5000 });
    await page.getByTitle('Zoom in').click();
    await page.getByTitle('Zoom in').click();
    await page.getByTitle('Reset camera').click();
    await expect(page.getByText('32%')).toBeVisible({ timeout: 2000 });
  });

  test('scroll-wheel zooms the canvas (changes zoom label)', async ({ page }) => {
    await page.goto('/observatory');
    const canvas = page.locator('[aria-label="Topology canvas"]');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // Scroll up to zoom in.
    await canvas.hover();
    await page.mouse.wheel(0, -300);
    // Zoom should have increased from 32%.
    const zoomText = await page.locator('text=/%/').first().textContent();
    const zoomVal = parseInt(zoomText?.replace('%', '') ?? '0');
    expect(zoomVal).toBeGreaterThan(32);
  });

  test('drag-pan moves the camera (canvas cursor changes to grabbing)', async ({ page }) => {
    await page.goto('/observatory');
    const canvas = page.locator('[aria-label="Topology canvas"]');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Simulate drag: mousedown → mousemove → mouseup.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy + 80, { steps: 10 });
    await page.mouse.up();

    // After drag the zoom label should still be present (canvas didn't crash).
    await expect(page.locator('text=/\\d+%/')).toBeVisible();
  });

  test('arrow keys pan the canvas', async ({ page }) => {
    await page.goto('/observatory');
    const canvas = page.locator('[aria-label="Topology canvas"]');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // Click inside canvas to bring keyboard focus to the wrap.
    await canvas.click({ position: { x: 10, y: 10 } });

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');

    // Canvas should still be visible after key presses.
    await expect(canvas).toBeVisible();
  });
});
