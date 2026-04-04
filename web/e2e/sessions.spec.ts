import { test, expect } from './fixtures';
import { createSession, deleteSession, uniqueSessionName } from './helpers/api';

test.describe('sessions', () => {
  test('session list loads and shows empty state', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await expect(page).toHaveURL(/\/volundr/);
    await expect(page.getByText('Select a session to view details')).toBeVisible();
    await expect(page.getByRole('button', { name: /New Session/i })).toBeVisible();
  });

  test('create session flow', async ({ authenticatedPage, request }) => {
    const page = authenticatedPage;
    const sessionName = uniqueSessionName('e2e-create');

    // Open the launch wizard
    await page.getByRole('button', { name: /New Session/i }).click();

    // Step 1: Choose template — pick Blank
    await expect(page.getByText('Blank')).toBeVisible();
    await page.getByText('Blank').click();

    // Step 2: Configure — fill in session details
    const nameInput = page.getByPlaceholder('e.g. feature-auth-refactor');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(sessionName);

    // Select source type: Local Mount (default may be git, toggle to local)
    const localMountButton = page.getByRole('button', { name: /Local Mount/i });
    if (await localMountButton.isVisible()) {
      await localMountButton.click();
    }

    // Fill local mount path
    const mountInput = page.getByPlaceholder(
      /Absolute path to your project/i,
    );
    if (await mountInput.isVisible()) {
      await mountInput.fill('/tmp/e2e-workspace');
    }

    // Select a model
    const modelSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Select model...' }) });
    if (await modelSelect.isVisible()) {
      // Pick the first non-empty option
      const options = modelSelect.locator('option');
      const count = await options.count();
      for (let i = 0; i < count; i++) {
        const val = await options.nth(i).getAttribute('value');
        if (val && val !== '') {
          await modelSelect.selectOption(val);
          break;
        }
      }
    }

    // Proceed to Review step
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: Review & Launch
    await expect(page.getByText('Review & Launch').or(page.getByText(sessionName))).toBeVisible();
    await page.getByRole('button', { name: /Launch Session/i }).click();

    // Verify session appears in sidebar/list (wait for creation to complete)
    await expect(page.getByText(sessionName)).toBeVisible({ timeout: 30_000 });
  });

  test('session detail view', async ({ authenticatedPage, request }) => {
    const page = authenticatedPage;

    // Seed a session via API
    const session = await createSession(request);

    // Reload to pick up the new session from SSE
    await page.reload();
    await page.waitForURL('**/volundr', { timeout: 15_000 });

    // Click on the session in the list
    await page.getByText(session.name).click();

    // Verify detail panel shows session info
    await expect(page.getByText(session.name)).toBeVisible();

    // The session bar should show status and action buttons
    await expect(
      page.getByRole('button', { name: /Stop|Start/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('delete session', async ({ authenticatedPage, request }) => {
    const page = authenticatedPage;

    // Seed a session via API
    const session = await createSession(request);

    // Reload to pick up the new session
    await page.reload();
    await page.waitForURL('**/volundr', { timeout: 15_000 });

    // Select the session
    await page.getByText(session.name).click();

    // Click delete button
    await page.getByRole('button', { name: /Delete session/i }).click();

    // Confirm deletion in dialog
    const confirmButton = page.getByTestId('delete-session-confirm');
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Verify session is removed from the list
    await expect(page.getByText(session.name)).toBeHidden({ timeout: 10_000 });
  });
});
