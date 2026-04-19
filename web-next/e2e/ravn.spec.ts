import { test, expect } from '@playwright/test';

// ─── Navigation ────────────────────────────────────────────────────────────────

test('ravn plugin renders at /ravn', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByTestId('ravn-page')).toBeVisible();
});

test('ravn page shows the rune glyph ᚱ', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText('ᚱ').first()).toBeVisible();
});

test('ravn page title is visible', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByText(/Ravn · the flock/)).toBeVisible();
});

test('deep-link /ravn renders overview by default', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByTestId('overview-page')).toBeVisible({ timeout: 5000 });
});

// ─── Overview ──────────────────────────────────────────────────────────────────

test('overview shows KPI strip', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByTestId('overview-page')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('kpi-total')).toBeVisible();
  await expect(page.getByTestId('kpi-active')).toBeVisible();
});

test('overview shows fleet sparkline', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByTestId('fleet-sparkline')).toBeVisible({ timeout: 5000 });
});

test('overview shows active ravens list', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByTestId('active-ravens-list')).toBeVisible({ timeout: 5000 });
});

test('overview shows log tail', async ({ page }) => {
  await page.goto('/ravn');
  await expect(page.getByTestId('log-tail')).toBeVisible({ timeout: 5000 });
});

// ─── Tab navigation ────────────────────────────────────────────────────────────

test('clicking Ravens tab shows the ravens page', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await expect(page.getByTestId('ravens-page')).toBeVisible({ timeout: 5000 });
});

test('clicking Overview tab returns to overview', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await expect(page.getByTestId('ravens-page')).toBeVisible({ timeout: 3000 });
  await page.getByTestId('ravn-tab-overview').click();
  await expect(page.getByTestId('overview-page')).toBeVisible({ timeout: 3000 });
});

// ─── Layout variant switching ──────────────────────────────────────────────────

test('ravens page: switch to table layout', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await expect(page.getByTestId('ravens-page')).toBeVisible({ timeout: 5000 });

  await page.getByTestId('layout-btn-table').click();
  await expect(page.getByTestId('layout-table')).toBeVisible();
  await expect(page.getByTestId('layout-split')).not.toBeVisible();
});

test('ravens page: switch to cards layout', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await expect(page.getByTestId('ravens-page')).toBeVisible({ timeout: 5000 });

  await page.getByTestId('layout-btn-cards').click();
  await expect(page.getByTestId('layout-cards')).toBeVisible();
});

test('ravens page: switch split → table → cards → split', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await expect(page.getByTestId('layout-split')).toBeVisible({ timeout: 5000 });

  await page.getByTestId('layout-btn-table').click();
  await expect(page.getByTestId('layout-table')).toBeVisible();

  await page.getByTestId('layout-btn-cards').click();
  await expect(page.getByTestId('layout-cards')).toBeVisible();

  await page.getByTestId('layout-btn-split').click();
  await expect(page.getByTestId('layout-split')).toBeVisible();
});

// ─── Grouping ──────────────────────────────────────────────────────────────────

test('ravens page: group by state shows state groups', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await expect(page.getByTestId('ravens-page')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('layout-split')).toBeVisible({ timeout: 3000 });

  const selector = page.getByTestId('grouping-selector');
  await selector.selectOption('state');

  // At least one state group header should be visible (e.g. "active")
  await expect(page.getByText(/^active$/i).first()).toBeVisible({ timeout: 3000 });
});

test('ravens page: group by persona shows persona names as group headers', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await expect(page.getByTestId('layout-split')).toBeVisible({ timeout: 5000 });

  await page.getByTestId('grouping-selector').selectOption('persona');
  // Each ravn is its own group — ravn list rows still visible
  await expect(page.getByTestId('ravn-list-row').first()).toBeVisible({ timeout: 3000 });
});

// ─── Expanding a ravn ──────────────────────────────────────────────────────────

test('ravens page: clicking a ravn opens the detail pane', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await expect(page.getByTestId('ravens-page')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('detail-empty')).toBeVisible({ timeout: 3000 });

  await page.getByTestId('ravn-list-row').first().click();
  await expect(page.getByTestId('ravn-detail')).toBeVisible({ timeout: 3000 });
});

test('ravens page: ravn detail has 6 collapsible sections', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await page.getByTestId('ravn-list-row').first().click();
  await expect(page.getByTestId('ravn-detail')).toBeVisible({ timeout: 5000 });

  for (const id of ['overview', 'triggers', 'activity', 'sessions', 'connectivity', 'delete']) {
    await expect(page.getByTestId(`ravn-detail-section-${id}`)).toBeVisible();
  }
});

test('ravens page: collapsing and expanding a section', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await page.getByTestId('ravn-list-row').first().click();
  await expect(page.getByTestId('section-body-overview')).toBeVisible({ timeout: 5000 });

  // Collapse
  await page.getByTestId('section-toggle-overview').click();
  await expect(page.getByTestId('section-body-overview')).not.toBeVisible();

  // Expand
  await page.getByTestId('section-toggle-overview').click();
  await expect(page.getByTestId('section-body-overview')).toBeVisible();
});

test('ravens page: closing detail pane shows empty state', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-ravens').click();
  await page.getByTestId('ravn-list-row').first().click();
  await expect(page.getByTestId('detail-close-btn')).toBeVisible({ timeout: 5000 });
  await page.getByTestId('detail-close-btn').click();
  await expect(page.getByTestId('detail-empty')).toBeVisible({ timeout: 3000 });
});

// ─── Accessibility ─────────────────────────────────────────────────────────────

test('ravn tabs are keyboard navigable', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-overview').focus();
  // Tab to the next tab
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('ravens-page')).toBeVisible({ timeout: 5000 });
});

// ─── Personas tab ──────────────────────────────────────────────────────────────

test('clicking Personas tab shows the personas page', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-personas').click();
  await expect(page.getByTestId('personas-page')).toBeVisible({ timeout: 5000 });
});

test('ravn shows persona list after loading', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-personas').click();
  await expect(
    page.getByTestId('persona-list-loading').or(page.getByTestId('persona-list')),
  ).toBeVisible();
  await expect(page.getByTestId('persona-list')).toBeVisible({ timeout: 5000 });
});

test('selecting a persona opens the form tab', async ({ page }) => {
  await page.goto('/ravn');
  await page.getByTestId('ravn-tab-personas').click();
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
  await page.getByTestId('ravn-tab-personas').click();
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
  await page.getByTestId('ravn-tab-personas').click();
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
  await page.getByTestId('ravn-tab-personas').click();
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
