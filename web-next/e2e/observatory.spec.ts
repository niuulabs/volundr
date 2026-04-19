import { test, expect } from '@playwright/test';

test.describe('observatory plugin', () => {
  test('rail button is visible and navigates to /observatory', async ({ page }) => {
    await page.goto('/hello');
    await expect(page.getByText('hello · smoke test')).toBeVisible();

    const obsButton = page.getByTitle('Flokk · Observatory · live topology & entity registry');
    await expect(obsButton).toBeVisible();

    await obsButton.click();
    await expect(page).toHaveURL(/\/observatory/);
    await expect(page.getByText('Flokk · Observatory')).toBeVisible();
  });

  test('deep link /observatory renders the page', async ({ page }) => {
    await page.goto('/observatory');
    await expect(page.getByText('Flokk · Observatory')).toBeVisible();
    await expect(page.getByText(/Live topology view/)).toBeVisible();
    await expect(
      page.getByText(/loading registry/).or(page.getByText('entity types')),
    ).toBeVisible();
    await expect(page.getByText('entity types')).toBeVisible({ timeout: 5000 });
  });

  test('observatory page shows registry version after load', async ({ page }) => {
    await page.goto('/observatory');
    await expect(page.getByText('registry version')).toBeVisible({ timeout: 5000 });
  });

  test('localStorage.niuu.active is set to observatory when visiting it', async ({ page }) => {
    await page.goto('/observatory');
    await expect(page.getByText('Flokk · Observatory')).toBeVisible();

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
});
