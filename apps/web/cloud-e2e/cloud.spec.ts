import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// A mock API exercises the real browser SDK and UI, not a live Supabase service or RLS.
const owner = '4a122f51-c5f7-41b2-bfea-4bd25e1d9eb3';
const token = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ sub: owner, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.test`;
type Backup = { id: string; owner_id: string; backup: string; created_at: string };
async function mockCloud(page: Page) {
  const backups: Backup[] = [];
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'content-type': 'application/json' };
  await page.route('https://test-project.supabase.co/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/auth/v1/token') return route.fulfill({ status: 200, headers, json: { access_token: token, refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600, user: { id: owner, aud: 'authenticated', role: 'authenticated', email: 'owner@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } } });
    if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers });
    if (['/rest/v1/land_expert_tenants', '/rest/v1/land_expert_tenant_memberships', '/rest/v1/land_expert_tenant_licenses'].includes(url.pathname)) {
      return route.fulfill({ status: 200, headers, json: [] });
    }
    if (url.pathname === '/rest/v1/land_expert_cloud_backups') {
      if (request.headers().authorization !== `Bearer ${token}`) return route.fulfill({ status: 401, headers, json: { message: 'Unauthorized' } });
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        if (body.owner_id !== owner) return route.fulfill({ status: 403, headers });
        backups.push({ ...body, created_at: '2026-01-01T00:00:00+00:00' });
        return route.fulfill({ status: 201, headers, body: '' });
      }
      const id = url.searchParams.get('id')?.replace(/^eq\./, '');
      if (request.method() === 'DELETE') {
        const index = backups.findIndex(row => row.id === id && row.owner_id === owner);
        return route.fulfill({ status: 200, headers, json: index < 0 ? [] : [{ id: backups.splice(index, 1)[0].id }] });
      }
      if (url.searchParams.get('select') === 'backup') {
        const row = backups.find(item => item.id === id && item.owner_id === owner);
        return row ? route.fulfill({ status: 200, headers, json: { backup: row.backup } }) : route.fulfill({ status: 406, headers, json: { message: 'Not found' } });
      }
      return route.fulfill({ status: 200, headers, json: backups.filter(row => row.owner_id === owner).map(row => ({ id: row.id, created_at: row.created_at })) });
    }
    return route.fulfill({ status: 404, headers, json: { message: 'Unexpected mock request' } });
  });
  return backups;
}

test('explicit cloud upload, conflict-safe restore, recovery and deletion using a mock API', async ({ page }) => {
  const backups = await mockCloud(page);
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Cloud field');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'plot.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Open Cloud field' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Email address').fill('owner@example.com');
  await page.getByLabel('Password', { exact: true }).fill('example-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Signed in as owner@example.com')).toBeVisible();
  expect(backups).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Upload local backup' }).click();
  await expect(page.getByText(/Backup uploaded/)).toBeVisible();
  expect(backups).toHaveLength(1);
  expect(JSON.parse(backups[0].backup).projects[0].features[0].geometry.coordinates).toEqual([90.4, 23.8]);
  await page.getByRole('button', { name: 'Refresh cloud backups' }).click();
  const id = backups[0].id;
  await expect(page.getByRole('button', { name: `Restore cloud backup ${id}` })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: `Restore cloud backup ${id}` }).click();
  await expect(page.getByRole('alert')).toContainText('Restore failed');
  await page.getByRole('link', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete Cloud field' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Cloud field' }).click();
  await expect(page.getByRole('button', { name: 'Open Cloud field' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh cloud backups' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: `Restore cloud backup ${id}` }).click();
  await expect(page.getByText('Cloud backup restored locally. Refresh saved copies in the survey workspace.')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: `Delete cloud backup ${id}` }).click();
  await expect(page.getByText('Cloud backup deleted.')).toBeVisible();
  expect(backups).toHaveLength(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Cloud field' })).toBeVisible();
});

for (const width of [320, 1366]) for (const language of ['en', 'bn']) test(`configured account controls are accessible at ${width} in ${language}`, async ({ page }) => {
  await mockCloud(page); await page.setViewportSize({ width, height: 800 }); await page.goto('/settings');
  if (language === 'bn') await page.locator('#header-language').selectOption('bn');
  await expect(page.locator('#cloud-email')).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => node.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
