import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [320, 1366]) {
  for (const language of ['en', 'bn'] as const) {
    test(`saved projects accessibility at ${width}px in ${language}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/survey');
      await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
      const geojson = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
      await page.getByLabel('Name for imported project').fill('Accessible plot');
      await page.getByLabel('GeoJSON file').setInputFiles({ name: 'plot.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(geojson) });
      await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
      await page.getByRole('button', { name: 'Import as new copy' }).click();
      await expect(page.getByRole('button', { name: 'Open Accessible plot' })).toBeEnabled();
      if (language === 'bn') await page.locator('#header-language').selectOption('bn');
      const audit = async () => {
        const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
      };
      await audit();
      await page.getByRole('button', { name: language === 'en' ? 'Rename Accessible plot' : 'Accessible plot-এর নাম বদলান' }).click();
      await audit();
    });
  }
}

for (const width of [320, 1366]) {
  for (const language of ['en', 'bn'] as const) {
    test(`online basemap accessibility at ${width}px in ${language}`, async ({ page }) => {
      const { readFile } = await import('node:fs/promises');
      const png = await readFile(new URL('./fixtures/tile.png', import.meta.url));
      await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*' } }));
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/survey');
      await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
      if (language === 'bn') await page.locator('#header-language').selectOption('bn');
      await page.locator('#basemap-select').selectOption('osm');
      await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

for (const width of [320, 1366]) {
  for (const language of ['en', 'bn'] as const) {
    test(`GPS and reference image controls at ${width}px in ${language}`, async ({ page, context }) => {
      await context.grantPermissions(['geolocation']);
      await context.setGeolocation({ latitude: 23.8, longitude: 90.4, accuracy: 17 });
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/survey');
      await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
      if (language === 'bn') await page.locator('#header-language').selectOption('bn');
      await page.getByRole('button', { name: language === 'en' ? 'Get current location' : 'বর্তমান অবস্থান নিন' }).click();
      await expect(page.getByRole('button', { name: language === 'en' ? 'Center map on location' : 'অবস্থানে মানচিত্রের কেন্দ্র নিন' })).toBeEnabled();
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}
