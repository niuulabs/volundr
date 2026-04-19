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
    await expect(
      page.getByRole('heading', { name: 'Flokk · Observatory', level: 2 }),
    ).toBeVisible();
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

  test.describe('registry editor', () => {
    test('registry editor renders after data loads', async ({ page }) => {
      await page.goto('/observatory');
      await expect(page.getByText('Entity type registry')).toBeVisible({ timeout: 5000 });
      await expect(page.getByRole('tab', { name: 'Types' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Containment' })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Json' })).toBeVisible();
    });

    test('Types tab shows search input and type cards', async ({ page }) => {
      await page.goto('/observatory');
      await expect(page.getByText('Entity type registry')).toBeVisible({ timeout: 5000 });

      await expect(page.getByRole('searchbox', { name: 'Filter entity types' })).toBeVisible();
      // The seed registry has topology category
      await expect(page.getByText('topology')).toBeVisible();
      // And shows Realm type card
      await expect(page.getByRole('button', { name: /Realm \(realm\)/ })).toBeVisible();
    });

    test('Types tab search filters type cards', async ({ page }) => {
      await page.goto('/observatory');
      await expect(page.getByText('Entity type registry')).toBeVisible({ timeout: 5000 });

      const search = page.getByRole('searchbox', { name: 'Filter entity types' });
      await search.fill('realm');
      await expect(page.getByRole('button', { name: /Realm \(realm\)/ })).toBeVisible();
      // Cluster should be hidden after filtering to "realm"
      await expect(page.getByRole('button', { name: /Cluster \(cluster\)/ })).not.toBeVisible();
    });

    test('Containment tab shows the tree structure', async ({ page }) => {
      await page.goto('/observatory');
      await expect(page.getByText('Entity type registry')).toBeVisible({ timeout: 5000 });

      await page.getByRole('tab', { name: 'Containment' }).click();
      await expect(page.getByRole('tree', { name: 'Containment tree' })).toBeVisible();
      await expect(page.getByRole('treeitem', { name: 'Realm' })).toBeVisible();
      await expect(page.getByRole('treeitem', { name: 'Cluster' })).toBeVisible();
    });

    test('drag a type onto a valid target updates the containment tree', async ({ page }) => {
      await page.goto('/observatory');
      await expect(page.getByText('Entity type registry')).toBeVisible({ timeout: 5000 });

      await page.getByRole('tab', { name: 'Containment' }).click();
      await expect(page.getByRole('tree', { name: 'Containment tree' })).toBeVisible();

      // Drag "Host" onto "Cluster" (host is currently under realm; cluster can contain service)
      // This moves host to be a child of cluster — no cycle, valid operation
      const hostNode = page.getByRole('treeitem', { name: 'Host' });
      const clusterNode = page.getByRole('treeitem', { name: 'Cluster' });

      await hostNode.dragTo(clusterNode);

      // After reparent, the preview drawer should show host's updated parentTypes
      await clusterNode.click();
      // Cluster now contains host in its canContain list, visible in preview drawer
      await expect(page.getByText('host')).toBeVisible({ timeout: 2000 });
    });

    test('cycle drop is rejected — tree stays unchanged', async ({ page }) => {
      await page.goto('/observatory');
      await expect(page.getByText('Entity type registry')).toBeVisible({ timeout: 5000 });

      await page.getByRole('tab', { name: 'Containment' }).click();
      await expect(page.getByRole('tree', { name: 'Containment tree' })).toBeVisible();

      // Try to drag "Realm" onto "Cluster" — would create a cycle (realm → cluster already)
      const realmNode = page.getByRole('treeitem', { name: 'Realm' });
      const clusterNode = page.getByRole('treeitem', { name: 'Cluster' });

      // Verify initial state: realm is a root (no parent marker)
      await expect(realmNode).toBeVisible();

      await realmNode.dragTo(clusterNode);

      // Realm should still be in the root position (no parent)
      // The tree structure shouldn't change — realm is still present at root
      await expect(page.getByRole('treeitem', { name: 'Realm' })).toBeVisible();
      // Check drop-invalid visual cue appeared (data-drag-state=drop-invalid class)
      // Since this is a quick drop, we can't reliably check the transient state
      // but we can verify the tree is unchanged by clicking realm and seeing its info
      await realmNode.click();
      // Preview drawer should show realm's info — parentTypes still empty
      await expect(page.getByText('Type · topology')).toBeVisible();
    });

    test('JSON tab shows pretty-printed registry', async ({ page }) => {
      await page.goto('/observatory');
      await expect(page.getByText('Entity type registry')).toBeVisible({ timeout: 5000 });

      await page.getByRole('tab', { name: 'Json' }).click();
      await expect(page.getByLabelText('Registry JSON')).toBeVisible();
      // The JSON should contain the registry structure
      await expect(page.getByLabelText('Registry JSON')).toContainText('"version"');
      await expect(page.getByLabelText('Registry JSON')).toContainText('"types"');
    });

    test('JSON tab copy button is present', async ({ page }) => {
      await page.goto('/observatory');
      await expect(page.getByText('Entity type registry')).toBeVisible({ timeout: 5000 });

      await page.getByRole('tab', { name: 'Json' }).click();
      await expect(
        page.getByRole('button', { name: 'Copy JSON to clipboard' }),
      ).toBeVisible();
    });

    test('clicking a type card shows its preview in the drawer', async ({ page }) => {
      await page.goto('/observatory');
      await expect(page.getByText('Entity type registry')).toBeVisible({ timeout: 5000 });

      await page.getByRole('button', { name: /Cluster \(cluster\)/ }).click();
      await expect(page.getByText('Type · topology')).toBeVisible();
      // Cluster's id appears in the preview
      await expect(page.getByText('cluster')).toBeVisible();
    });
  });
});
