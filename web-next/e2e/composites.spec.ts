import { test, expect } from '@playwright/test';

test.describe('NIU-654 — Identity composites showcase', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/showcase');
    await expect(page.getByTestId('showcase')).toBeVisible({ timeout: 10_000 });
  });

  test('showcase page loads', async ({ page }) => {
    await expect(page.getByText('NIU-654 · Identity Composites Showcase')).toBeVisible();
  });

  test('PersonaAvatar — all 9 roles render', async ({ page }) => {
    const container = page.getByTestId('persona-avatars');
    await expect(container).toBeVisible();

    const roles = ['plan', 'build', 'verify', 'review', 'gate', 'audit', 'ship', 'index', 'report'];
    for (const role of roles) {
      await expect(container.getByRole('img', { name: role })).toBeVisible();
    }
  });

  test('PersonaAvatar — correct letter shown for build role', async ({ page }) => {
    const avatar = page.getByTestId('persona-avatars').getByRole('img', { name: 'build' });
    await expect(avatar).toBeVisible();
    await expect(avatar.getByText('B')).toBeVisible();
  });

  test('RavnAvatar — state variants render', async ({ page }) => {
    const container = page.getByTestId('ravn-avatars');
    await expect(container).toBeVisible();

    const states = ['healthy', 'running', 'idle', 'failed', 'observing'];
    for (const state of states) {
      await expect(container.getByRole('img', { name: `ravn-${state}` })).toBeVisible();
    }
  });

  test('MountChip — all three roles render', async ({ page }) => {
    const container = page.getByTestId('mount-chips');
    await expect(container).toBeVisible();

    await expect(container.getByText('local-ops')).toBeVisible();
    await expect(container.getByText('shared-realm')).toBeVisible();
    await expect(container.getByText('domain-kb')).toBeVisible();

    await expect(container.getByText('prim')).toBeVisible();
    await expect(container.getByText('arch')).toBeVisible();
    await expect(container.getByText('ro')).toBeVisible();
  });

  test('DeployBadge — all 5 kinds render with glyphs', async ({ page }) => {
    const container = page.getByTestId('deploy-badges');
    await expect(container).toBeVisible();

    await expect(container.getByText('◇')).toBeVisible();
    await expect(container.getByText('◈')).toBeVisible();
    await expect(container.getByText('◆')).toBeVisible();
    await expect(container.getByText('▲')).toBeVisible();
    await expect(container.getByText('◌')).toBeVisible();

    await expect(container.getByText('k8s')).toBeVisible();
    await expect(container.getByText('systemd')).toBeVisible();
    await expect(container.getByText('pi')).toBeVisible();
    await expect(container.getByText('mobile')).toBeVisible();
    await expect(container.getByText('ephemeral')).toBeVisible();
  });

  test('LifecycleBadge — all 8 states render', async ({ page }) => {
    const container = page.getByTestId('lifecycle-badges');
    await expect(container).toBeVisible();

    const states = [
      'requested',
      'provisioning',
      'ready',
      'running',
      'idle',
      'terminating',
      'terminated',
      'failed',
    ];
    for (const state of states) {
      await expect(container.getByText(state)).toBeVisible();
    }
  });

  test('LifecycleBadge — failed state has critical styling', async ({ page }) => {
    const container = page.getByTestId('lifecycle-badges');
    const badge = container.getByLabel('session state: failed');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveClass(/niuu-lifecycle-badge--failed/);
  });

  test('LifecycleBadge — running state has pulse class', async ({ page }) => {
    const container = page.getByTestId('lifecycle-badges');
    const badge = container.getByLabel('session state: running');
    await expect(badge).toHaveClass(/niuu-lifecycle-badge--pulse/);
  });

  test('keyboard accessibility — showcase page is tab-navigable', async ({ page }) => {
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
  });
});
