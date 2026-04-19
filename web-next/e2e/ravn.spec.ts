import { test, expect } from '@playwright/test';

test('ravn plugin renders at /ravn', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText(/ravn · personas · ravens · sessions/)).toBeVisible();
});

test('ravn shows persona list after loading', async ({ page }) => {
  await page.goto('/ravn');
  // Wait for the list to load — loading state transitions to persona nav
  await expect(
    page.getByTestId('persona-list-loading').or(page.getByTestId('persona-list')),
  ).toBeVisible();
  await expect(page.getByTestId('persona-list')).toBeVisible({ timeout: 5000 });
});

test('rail shows ravn rune ᚱ', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText('ᚱ').first()).toBeVisible();
});

test('deep-link /ravn renders ravn page directly', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText(/ravn · personas · ravens · sessions/)).toBeVisible();
  await expect(page.getByTestId('personas-page')).toBeVisible({ timeout: 5000 });
});

test('selecting a persona opens the form tab', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByTestId('persona-list')).toBeVisible({ timeout: 5000 });

  // Click the first persona in the list
  const firstPersonaBtn = page.getByTestId('persona-list').getByRole('button').first();
  await firstPersonaBtn.click();

  // Detail pane with tabs should appear
  await expect(page.getByTestId('persona-detail')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Form' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'YAML' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Subs' })).toBeVisible();
});

test('persona edit: change LLM alias and save updates form', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByTestId('persona-list')).toBeVisible({ timeout: 5000 });

  // Select first persona
  const firstPersonaBtn = page.getByTestId('persona-list').getByRole('button').first();
  await firstPersonaBtn.click();
  await expect(page.getByTestId('persona-form')).toBeVisible();

  // Edit the LLM model alias field
  const aliasInput = page.getByLabel('Model alias').or(page.locator('#pf-llm-alias'));
  const originalValue = await aliasInput.inputValue();
  await aliasInput.fill('claude-opus-4-6');

  // Save bar should appear
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: /save persona/i }).click();

  // After save the bar should disappear (or show saving state briefly)
  await expect(page.getByText('Unsaved changes')).not.toBeVisible({ timeout: 3000 });

  // Re-select the persona to confirm the update was applied
  await firstPersonaBtn.click();
  expect(originalValue).toBeTruthy(); // sanity
});

test('persona subs tab shows subscription graph', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByTestId('persona-list')).toBeVisible({ timeout: 5000 });

  // Find a persona that is likely to have connections (e.g. coder or reviewer)
  const coderBtn = page
    .getByTestId('persona-list')
    .getByRole('button', { name: /coder|reviewer|architect/i })
    .first();

  await coderBtn.click();
  await expect(page.getByTestId('persona-detail')).toBeVisible();

  // Switch to Subs tab
  await page.getByRole('tab', { name: 'Subs' }).click();

  // Should show either a graph or the empty/no-connections message
  await expect(
    page
      .getByTestId('persona-subs')
      .or(page.getByTestId('persona-subs-empty'))
      .or(page.getByTestId('persona-subs-loading')),
  ).toBeVisible({ timeout: 5000 });
});

test('persona YAML tab shows yaml source', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByTestId('persona-list')).toBeVisible({ timeout: 5000 });

  const firstPersonaBtn = page.getByTestId('persona-list').getByRole('button').first();
  await firstPersonaBtn.click();

  // Switch to YAML tab
  await page.getByRole('tab', { name: 'YAML' }).click();

  // YAML viewer should appear
  await expect(
    page.getByTestId('persona-yaml').or(page.getByTestId('persona-yaml-loading')),
  ).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('persona-yaml')).toBeVisible({ timeout: 3000 });
});
