import { test, expect } from '@playwright/test';

test('draws a polygon and shows geographic measurements', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/survey');
  await expect(page.getByRole('heading', { name: 'Drawing workspace' })).toBeVisible();
  const polygon = page.getByRole('button', { name: 'Polygon' });
  await expect(polygon).toBeEnabled();
  await polygon.click();
  const canvas = page.locator('.survey-map canvas');
  await canvas.click({ position: { x: 150, y: 150 } });
  await canvas.click({ position: { x: 260, y: 150 } });
  await canvas.click({ position: { x: 260, y: 240 } });
  await canvas.click({ position: { x: 150, y: 150 } });
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await canvas.click({ position: { x: 230, y: 180 } });
  await expect(page.getByText('Area', { exact: true })).toBeVisible();
  await expect(page.getByText('Perimeter', { exact: true })).toBeVisible();
  await expect(page.getByText('Coordinates (latitude, longitude)')).toBeVisible();
});

test('asks before discarding an unfinished polygon and before leaving', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/survey');
  const polygon = page.getByRole('button', { name: 'Polygon' });
  await expect(polygon).toBeEnabled();
  await polygon.click();
  await page.locator('.survey-map canvas').click({ position: { x: 150, y: 150 } });
  const cancel = page.getByRole('button', { name: 'Cancel drawing' });
  await expect(cancel).toBeEnabled();
  const dismissed = new Promise<void>(resolve => page.once('dialog', async dialog => { await dialog.dismiss(); resolve(); }));
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await dismissed;
  await expect(page.getByRole('heading', { name: 'Drawing workspace' })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await cancel.click();
  await expect(cancel).toBeDisabled();
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});

test('browser back prompts before leaving completed work', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/');
  await page.getByRole('link', { name: 'Survey', exact: true }).click();
  const point = page.getByRole('button', { name: 'Point', exact: true });
  await expect(point).toBeEnabled();
  await point.click();
  await page.locator('.survey-map canvas').click({ position: { x: 150, y: 150 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Drawing workspace' })).toBeVisible();
});

test('saves a local copy and reopens it after refresh', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/survey');
  const point = page.getByRole('button', { name: 'Point', exact: true });
  await expect(point).toBeEnabled();
  await point.click();
  await page.locator('.survey-map canvas').click({ position: { x: 150, y: 150 } });
  await page.getByLabel('Project name').fill('Field copy');
  await page.getByRole('button', { name: 'Save copy' }).click();
  await expect(page.getByText('Project copy saved on this device.')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open Field copy' })).toBeEnabled();
  await page.getByRole('button', { name: 'Open Field copy' }).click();
  await expect(page.getByText('Project opened in the editor. Changes are not saved automatically.')).toBeVisible();
  await expect(page.getByText('1 completed feature')).toBeVisible();
});

test('exports GeoJSON and restores a saved project backup', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/survey');
  const point = page.getByRole('button', { name: 'Point', exact: true });
  await expect(point).toBeEnabled();
  await point.click();
  await page.locator('.survey-map canvas').click({ position: { x: 150, y: 150 } });
  await page.getByLabel('Project name').fill('Backup test');
  await page.getByRole('button', { name: 'Save copy' }).click();
  await expect(page.getByText('Project copy saved on this device.')).toBeVisible();
  const geojsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GeoJSON for Backup test' }).click();
  expect((await geojsonDownload).suggestedFilename()).toMatch(/\.geojson$/);
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const backup = await backupDownload;
  const path = await backup.path();
  expect(path).not.toBeNull();
  const { readFile } = await import('node:fs/promises');
  const data = await readFile(path!);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete Backup test' }).click();
  await expect(page.getByText('No saved project copies yet.')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Restore backup file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: data });
  await expect(page.getByText('Backup restored to this browser.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Backup test' })).toBeVisible();
});

test('imports valid GeoJSON as a project and opens it', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Imported map');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'land.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  const confirmation = page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.');
  await expect(page.getByRole('button', { name: 'Import as new copy' })).toBeDisabled();
  await confirmation.check();
  await expect(page.getByRole('button', { name: 'Import as new copy' })).toBeEnabled();
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'another.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await expect(confirmation).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Import as new copy' })).toBeDisabled();
  await confirmation.check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByText(/GeoJSON imported as a new local project copy/)).toBeVisible();
  await expect(confirmation).not.toBeChecked();
  await page.getByRole('button', { name: 'Open Imported map' }).click();
  await expect(page.getByText('1 completed feature')).toBeVisible();
});

test('downloads an English PDF for a saved ASCII-named project', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Field');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByText(/GeoJSON imported as a new local project copy/)).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF for Field' }).click();
  const download = await pending;
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const data = await readFile(path!);
  expect(data.subarray(0, 5).toString()).toBe('%PDF-');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const document = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false }).promise;
  const pageText = await (await document.getPage(1)).getTextContent();
  const text = pageText.items.map(item => 'str' in item ? item.str : '').join(' ');
  expect(text).toContain('Land survey summary');
  expect(text).toContain('Field');
  await document.cleanup();
});

for (const width of [320, 375, 430, 768, 1024, 1366, 1920]) {
  test(`survey controls fit at ${width}px in English and Bengali`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/survey');
    await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel('Language', { exact: true }).selectOption('bn');
    await expect(page.getByRole('button', { name: 'বিন্দু', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('touch interaction creates and selects a point on a small phone', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/survey');
  const point = page.getByRole('button', { name: 'Point', exact: true });
  await expect(point).toBeEnabled();
  await point.tap();
  const canvas = page.locator('.survey-map canvas');
  await canvas.tap({ position: { x: 120, y: 120 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
  await page.getByRole('button', { name: 'Select', exact: true }).tap();
  await canvas.tap({ position: { x: 120, y: 120 } });
  await expect(page.getByText('Coordinates (latitude, longitude)')).toBeVisible();
  await context.close();
});

test('editing a polygon vertex updates measurements and undo restores them', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/survey');
  const polygon = page.getByRole('button', { name: 'Polygon' });
  await expect(polygon).toBeEnabled(); await polygon.click();
  const canvas = page.locator('.survey-map canvas');
  for (const position of [{ x: 150, y: 150 }, { x: 260, y: 150 }, { x: 260, y: 240 }, { x: 150, y: 150 }]) await canvas.click({ position });
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await canvas.click({ position: { x: 230, y: 180 } });
  const area = page.locator('.measurement-results > div').first().locator('strong');
  const original = await area.innerText();
  const rect = await canvas.boundingBox(); if (!rect) throw new Error('Map canvas unavailable');
  await page.mouse.move(rect.x + 150, rect.y + 150); await page.mouse.down();
  await page.mouse.move(rect.x + 125, rect.y + 120, { steps: 8 }); await page.mouse.up();
  await expect(area).not.toHaveText(original);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await canvas.click({ position: { x: 230, y: 180 } });
  await expect(area).toHaveText(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await canvas.click({ position: { x: 230, y: 180 } });
  await expect(area).not.toHaveText(original);
  const edited = await area.innerText();
  await page.getByLabel('Project name').fill('Edited polygon');
  await page.getByRole('button', { name: 'Save copy' }).click();
  await expect(page.getByText('Project copy saved on this device.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open Edited polygon' })).toBeEnabled();
  await page.getByRole('button', { name: 'Open Edited polygon' }).click();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const reopenedMap = await canvas.boundingBox(); if (!reopenedMap) throw new Error('Map canvas unavailable');
  await canvas.click({ position: { x: reopenedMap.width * 0.6, y: reopenedMap.height * 0.4 } });
  await expect(area).toHaveText(edited);
});


test('landscape phone survey controls fit and allow touch drawing', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 812, height: 375 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto('/survey');
  const point = page.getByRole('button', { name: 'Point', exact: true });
  await expect(point).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await point.tap();
  await page.locator('.survey-map canvas').tap({ position: { x: 120, y: 120 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
  await context.close();
});

test('stale tab cannot delete a copy renamed in another tab and can refresh the list', async ({ context, page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Shared copy');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Delete Shared copy' })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/survey');
  await other.getByRole('button', { name: 'Rename Shared copy' }).click();
  await other.getByLabel('New project name').fill('Renamed copy');
  await other.getByRole('button', { name: 'Save name' }).click();
  await expect(other.getByRole('button', { name: 'Delete Renamed copy' })).toBeVisible();
  const confirmed = new Promise<void>(resolve => page.once('dialog', async dialog => { await dialog.accept(); resolve(); }));
  await page.getByRole('button', { name: 'Delete Shared copy' }).click();
  await confirmed;
  await expect(page.getByRole('alert')).toContainText('Delete failed');
  await page.getByRole('button', { name: 'Refresh saved copies' }).click();
  await expect(page.getByRole('button', { name: 'Delete Renamed copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete Shared copy' })).toHaveCount(0);
  await other.reload();
  await expect(other.getByRole('button', { name: 'Open Renamed copy' })).toBeVisible();
  await other.close();
});

test('backup restore cancellation and a conflicting batch leave saved copies unchanged', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const geojson = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Existing copy');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(geojson) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Open Existing copy' })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const { readFile } = await import('node:fs/promises');
  const path = await (await pending).path();
  expect(path).not.toBeNull();
  const backup = JSON.parse((await readFile(path!)).toString());
  const { randomUUID } = await import('node:crypto');
  const fresh = { ...backup.projects[0], id: randomUUID(), name: 'Fresh copy', features: backup.projects[0].features.map((feature: { id: string }) => ({ ...feature, id: randomUUID() })) };
  const file = { name: 'conflicting.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...backup, projects: [fresh, backup.projects[0]] })) };
  const dismissed = new Promise<void>(resolve => page.once('dialog', async dialog => { await dialog.dismiss(); resolve(); }));
  await page.getByLabel('Restore backup file').setInputFiles(file);
  await dismissed;
  await expect(page.getByRole('button', { name: 'Open Existing copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Fresh copy' })).toHaveCount(0);
  const accepted = new Promise<void>(resolve => page.once('dialog', async dialog => { await dialog.accept(); resolve(); }));
  await page.getByLabel('Restore backup file').setInputFiles(file);
  await accepted;
  await expect(page.getByRole('alert')).toContainText('Restore failed');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open Existing copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Fresh copy' })).toHaveCount(0);
});

test('Bengali PDF remains unavailable and non-ASCII names are rejected without changing saved data', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await expect(page.getByRole('option', { name: 'বাংলা' }).last()).toBeDisabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('জমি');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Download PDF for জমি' })).toBeVisible();
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'Download PDF for জমি' }).click();
  await expect(page.getByRole('alert')).toContainText('Only English reports with ASCII project names');
  expect(downloads).toEqual([]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open জমি' })).toBeVisible();
});

test('backs up and restores a single saved project without changing another', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  for (const [name, longitude] of [['First copy', 90.4], ['Second copy', 90.5]] as const) {
    const geojson = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, 23.8] }, properties: {} }] });
    await page.getByLabel('Name for imported project').fill(name);
    await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(geojson) });
    await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
    await page.getByRole('button', { name: 'Import as new copy' }).click();
    await expect(page.getByRole('button', { name: `Open ${name}` })).toBeVisible();
  }
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up First copy' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/^land-expert-[0-9a-f-]+-backup\.json$/);
  const path = await download.path(); expect(path).not.toBeNull();
  const { readFile } = await import('node:fs/promises');
  const data = await readFile(path!);
  const backup = JSON.parse(data.toString());
  expect(backup.format).toBe('land-expert-backup');
  expect(backup.version).toBe(1);
  expect(backup.projects).toHaveLength(1);
  expect(backup.projects[0].name).toBe('First copy');
  expect(backup.projects[0].features[0].geometry.coordinates).toEqual([90.4, 23.8]);
  const deleteAccepted = new Promise<void>(resolve => page.once('dialog', async dialog => { await dialog.accept(); resolve(); }));
  await page.getByRole('button', { name: 'Delete First copy' }).click(); await deleteAccepted;
  await expect(page.getByRole('button', { name: 'Open First copy' })).toHaveCount(0);
  const restoreAccepted = new Promise<void>(resolve => page.once('dialog', async dialog => { await dialog.accept(); resolve(); }));
  await page.getByLabel('Restore backup file').setInputFiles({ name: 'single.json', mimeType: 'application/json', buffer: data }); await restoreAccepted;
  await expect(page.getByText('Backup restored to this browser.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open First copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Second copy' })).toBeVisible();
  const afterPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
  const afterPath = await (await afterPending).path(); expect(afterPath).not.toBeNull();
  const after = JSON.parse((await readFile(afterPath!)).toString());
  expect(after.projects).toHaveLength(2);
  expect(after.projects.find((project: { name: string }) => project.name === 'First copy')).toEqual(backup.projects[0]);
  expect(after.projects.find((project: { name: string }) => project.name === 'Second copy').features[0].geometry.coordinates).toEqual([90.5, 23.8]);
});

test('saved project backup controls fit at supported widths in both languages', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const geojson = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Test plot');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(geojson) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Back up Test plot' })).toBeVisible();
  for (const width of [320, 375, 430, 768, 1024, 1366, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('#header-language').selectOption('en');
    await expect(page.getByRole('button', { name: 'Back up Test plot' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `English width ${width}`).toBe(true);
    await page.locator('#header-language').selectOption('bn');
    await expect(page.getByRole('button', { name: 'Test plot এর ব্যাকআপ' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Bengali width ${width}`).toBe(true);
  }
});

test('checks valid and invalid backup files without restoring or changing saved data', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const geojson = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Kept copy');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(geojson) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Back up Kept copy' })).toBeVisible();
  const beforeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up Kept copy' }).click();
  const path = await (await beforeDownload).path(); expect(path).not.toBeNull();
  const { readFile } = await import('node:fs/promises');
  const original = await readFile(path!);
  const input = page.getByLabel('Check backup file');
  await input.setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: original });
  await expect(page.getByRole('status')).toContainText('1 saved copy');
  await expect(page.getByRole('status')).toContainText('No data was restored');
  await expect(page.getByRole('status')).toContainText('1 project ID already exists here');
  const fresh = JSON.parse(original.toString());
  fresh.projects[0].id = (await import('node:crypto')).randomUUID();
  await input.setInputFiles({ name: 'fresh.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fresh)) });
  await expect(page.getByRole('status')).toContainText('No matching IDs were found');
  const invalid = JSON.parse(original.toString());
  invalid.projects[0].features[0].geometry.coordinates = [400, 23];
  await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole('alert')).toContainText('Backup check failed');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Back up Kept copy' })).toBeVisible();
  const afterDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up Kept copy' }).click();
  const afterPath = await (await afterDownload).path(); expect(afterPath).not.toBeNull();
  expect(JSON.parse((await readFile(afterPath!)).toString())).toEqual(JSON.parse(original.toString()));
});

test('unreadable local record is preserved while readable copies remain available', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const geojson = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Readable copy');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(geojson) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Back up Readable copy' })).toBeVisible();
  const bad = { id: '0a92cdf4-f1ca-4051-b5eb-b20e4d8f6482', schemaVersion: 2, name: 'Future data' };
  await page.evaluate(async record => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('land-expert-projects', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('projects', 'readwrite'); tx.objectStore('projects').add(record);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
    database.close();
  }, bad);
  // A different tab may introduce an unreadable row after the list was loaded.
  // The strict all-copy backup must fail rather than silently omit it.
  const downloads: string[] = [];
  page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not prepare the backup');
  expect(downloads).toEqual([]);
  await page.getByRole('button', { name: 'Refresh saved copies' }).click();
  await expect(page.getByRole('alert')).toContainText('1 stored record could not be read');
  await expect(page.getByRole('button', { name: 'Download backup', exact: true })).toBeDisabled();
  const diagnosticPending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download unreadable records diagnostic' }).click();
  const diagnostic = await diagnosticPending;
  expect(diagnostic.suggestedFilename()).toBe('land-expert-unreadable-diagnostic.json');
  const diagnosticPath = await diagnostic.path(); expect(diagnosticPath).not.toBeNull();
  const { readFile } = await import('node:fs/promises');
  const diagnosticContent = JSON.parse((await readFile(diagnosticPath!)).toString());
  expect(diagnosticContent).toEqual({ format: 'land-expert-unreadable-diagnostic', version: 1, records: [bad] });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up Readable copy' }).click();
  const path = await (await pending).path(); expect(path).not.toBeNull();
  const backup = JSON.parse((await readFile(path!)).toString());
  expect(backup.projects).toHaveLength(1); expect(backup.projects[0].name).toBe('Readable copy');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('1 stored record could not be read');
  await expect(page.getByRole('button', { name: 'Open Readable copy' })).toBeEnabled();
  const stored = await page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('land-expert-projects', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const record = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction('projects').objectStore('projects').get(id);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    database.close(); return record;
  }, bad.id);
  expect(stored).toEqual(bad);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#header-language').selectOption('bn');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('alert')).toBeVisible();
});

test('line editing inserts and deletes a vertex, then saves the edited geometry', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/survey');
  const line = page.getByRole('button', { name: 'Line', exact: true });
  await expect(line).toBeEnabled(); await line.click();
  const canvas = page.locator('.survey-map canvas');
  for (const position of [{ x: 150, y: 150 }, { x: 260, y: 150 }, { x: 320, y: 210 }]) await canvas.click({ position });
  await page.keyboard.press('Enter');
  await expect(page.getByText('1 completed feature')).toBeVisible();
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await canvas.click({ position: { x: 175, y: 150 } });
  const coordinates = page.locator('.measurement-results ol').last().locator('li');
  await expect(coordinates).toHaveCount(3);
  await canvas.click({ position: { x: 205, y: 150 } });
  await expect(coordinates).toHaveCount(4);
  await canvas.click({ position: { x: 205, y: 150 }, button: 'right' });
  await expect(coordinates).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await canvas.click({ position: { x: 175, y: 150 } });
  await expect(coordinates).toHaveCount(4);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await canvas.click({ position: { x: 175, y: 150 } });
  await expect(coordinates).toHaveCount(3);
  await page.getByLabel('Project name').fill('Edited line');
  await page.getByRole('button', { name: 'Save copy' }).click();
  await expect(page.getByText('Project copy saved on this device.')).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GeoJSON for Edited line' }).click();
  const file = await (await pending).path(); expect(file).not.toBeNull();
  const { readFile } = await import('node:fs/promises');
  const geojson = JSON.parse((await readFile(file!)).toString());
  expect(geojson.features).toHaveLength(1);
  expect(geojson.features[0].geometry.type).toBe('LineString');
  expect(geojson.features[0].geometry.coordinates).toHaveLength(3);
  await page.reload();
  await page.getByRole('button', { name: 'Open Edited line' }).click();
  await canvas.click({ position: { x: 175, y: 150 } });
  await expect(coordinates).toHaveCount(3);
  const pendingAgain = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GeoJSON for Edited line' }).click();
  const again = await (await pendingAgain).path(); expect(again).not.toBeNull();
  const reopened = JSON.parse((await readFile(again!)).toString());
  expect(reopened.features[0].geometry.coordinates).toEqual(geojson.features[0].geometry.coordinates);
});

test('draws and persists a rectangle as a closed polygon', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/survey');
  const rectangle = page.getByRole('button', { name: 'Rectangle', exact: true });
  await expect(rectangle).toBeEnabled(); await rectangle.click();
  const canvas = page.locator('.survey-map canvas');
  await canvas.click({ position: { x: 150, y: 150 } });
  await canvas.click({ position: { x: 300, y: 250 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
  await page.getByLabel('Project name').fill('Rectangle copy');
  await page.getByRole('button', { name: 'Save copy' }).click();
  await expect(page.getByText('Project copy saved on this device.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Open Rectangle copy' }).click();
  await expect(page.getByText('1 completed feature')).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export GeoJSON for Rectangle copy' }).click();
  const file = await (await pending).path(); expect(file).not.toBeNull();
  const { readFile } = await import('node:fs/promises');
  const geojson = JSON.parse((await readFile(file!)).toString());
  expect(geojson.features).toHaveLength(1);
  expect(geojson.features[0].geometry.type).toBe('Polygon');
  const ring = geojson.features[0].geometry.coordinates[0];
  expect(ring).toHaveLength(5);
  expect(ring[0]).toEqual(ring[4]);
});

test('touch completes a line, inserts a midpoint and persists the result', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await page.goto('/survey');
    const line = page.getByRole('button', { name: 'Line', exact: true });
    await expect(line).toBeEnabled();
    await line.tap();
    const canvas = page.locator('.survey-map canvas');
    for (const position of [{ x: 50, y: 80 }, { x: 180, y: 80 }, { x: 245, y: 160 }, { x: 245, y: 160 }]) await canvas.tap({ position });
    await expect(page.getByText('1 completed feature')).toBeVisible();
    await page.getByRole('button', { name: 'Select', exact: true }).tap();
    await canvas.tap({ position: { x: 80, y: 80 } });
    const coordinates = page.locator('.measurement-results ol').last().locator('li');
    await expect(coordinates).toHaveCount(3);
    await canvas.tap({ position: { x: 115, y: 80 } });
    await expect(coordinates).toHaveCount(4);
    await page.getByLabel('Project name').fill('Touch line');
    await page.getByRole('button', { name: 'Save copy' }).tap();
    await expect(page.getByText('Project copy saved on this device.')).toBeVisible();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export GeoJSON for Touch line' }).tap();
    const path = await (await pending).path(); expect(path).not.toBeNull();
    const { readFile } = await import('node:fs/promises');
    const saved = JSON.parse((await readFile(path!)).toString());
    expect(saved.features[0].geometry.type).toBe('LineString');
    expect(saved.features[0].geometry.coordinates).toHaveLength(4);
    await page.reload();
    await page.getByRole('button', { name: 'Open Touch line' }).tap();
    await expect(page.getByText('1 completed feature')).toBeVisible();
    const pendingAgain = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export GeoJSON for Touch line' }).tap();
    const again = await (await pendingAgain).path(); expect(again).not.toBeNull();
    const reopened = JSON.parse((await readFile(again!)).toString());
    expect(reopened.features[0].geometry.coordinates).toEqual(saved.features[0].geometry.coordinates);
  } finally { await context.close(); }
});

test('opening a copy switches the active drawing mode to select', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/survey');
  const pointTool = page.getByRole('button', { name: 'Point', exact: true });
  await expect(pointTool).toBeEnabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Open in select');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Open Open in select' })).toBeEnabled();
  await pointTool.click();
  await page.getByRole('button', { name: 'Open Open in select' }).click();
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const canvas = page.locator('.survey-map canvas');
  const box = await canvas.boundingBox(); if (!box) throw new Error('Map canvas unavailable');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByText('Coordinates (latitude, longitude)')).toBeVisible();
  const coordinates = page.locator('.measurement-results ol').last().locator('li');
  await expect(coordinates).toHaveCount(1);
  await expect(coordinates.first()).toContainText('23.8');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await canvas.click({ position: { x: box.width / 2 + 90, y: box.height / 2 + 90 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
});

test('stale rename cannot rename a same-name replacement restored from backup', async ({ context, page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Shared field');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Rename Shared field' })).toBeVisible();
  const other = await context.newPage();
  try {
    await other.goto('/survey');
    const downloading = other.waitForEvent('download');
    await other.getByRole('button', { name: 'Back up Shared field' }).click();
    const path = await (await downloading).path(); expect(path).not.toBeNull();
    const { readFile } = await import('node:fs/promises');
    const backup = JSON.parse((await readFile(path!)).toString());
    backup.projects[0].features[0].geometry.coordinates = [90.5, 23.9];
    other.once('dialog', dialog => dialog.accept());
    await other.getByRole('button', { name: 'Delete Shared field' }).click();
    await expect(other.getByText('No saved project copies yet.')).toBeVisible();
    other.once('dialog', dialog => dialog.accept());
    await other.getByLabel('Restore backup file').setInputFiles({ name: 'replacement.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await expect(other.getByText('Backup restored to this browser.')).toBeVisible();
    await page.getByRole('button', { name: 'Rename Shared field' }).click();
    await page.getByLabel('New project name').fill('Stale rename');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('alert')).toContainText('Could not complete the action');
    await page.getByRole('button', { name: 'Refresh saved copies' }).click();
    await expect(page.getByRole('button', { name: 'Rename Shared field' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rename Stale rename' })).toHaveCount(0);
    const exportPending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export GeoJSON for Shared field' }).click();
    const exportedPath = await (await exportPending).path(); expect(exportedPath).not.toBeNull();
    const exported = JSON.parse((await readFile(exportedPath!)).toString());
    expect(exported.features[0].geometry.coordinates).toEqual([90.5, 23.9]);
  } finally { await other.close(); }
});

test('stale duplicate is rejected after the source changes in another tab', async ({ context, page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Shared source');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await page.getByRole('button', { name: 'Duplicate Shared source' }).click();
  await page.getByLabel('Name for duplicate').fill('My duplicate');
  const other = await context.newPage();
  try {
    await other.goto('/survey');
    await other.getByRole('button', { name: 'Rename Shared source' }).click();
    await other.getByLabel('New project name').fill('Renamed source');
    await other.getByRole('button', { name: 'Save name' }).click();
    await expect(other.getByRole('button', { name: 'Open Renamed source' })).toBeVisible();
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('alert')).toContainText('Could not complete the action');
    await other.getByRole('button', { name: 'Refresh saved copies' }).click();
    await expect(other.getByRole('button', { name: 'Open My duplicate' })).toHaveCount(0);
    await expect(other.getByRole('button', { name: 'Open Renamed source' })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh saved copies' }).click();
    await page.getByRole('button', { name: 'Duplicate Renamed source' }).click();
    await page.getByLabel('Name for duplicate').fill('My duplicate');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('button', { name: 'Open My duplicate' })).toBeVisible();
  } finally { await other.close(); }
});

test('stale tab cannot open or download a changed project until refreshed', async ({ context, page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Old name');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'point.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Open Old name' })).toBeEnabled();
  const other = await context.newPage();
  try {
    await other.goto('/survey');
    await other.getByRole('button', { name: 'Rename Old name' }).click();
    await other.getByLabel('New project name').fill('New name');
    await other.getByRole('button', { name: 'Save name' }).click();
    await expect(other.getByRole('button', { name: 'Open New name' })).toBeVisible();
    let downloads = 0; page.on('download', () => downloads++);
    for (const name of ['Open Old name', 'Export GeoJSON for Old name', 'Back up Old name', 'Download PDF for Old name']) {
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('This copy changed or was removed');
    }
    expect(downloads).toBe(0);
    await expect(page.getByText('0 completed features')).toBeVisible();
    await page.getByRole('button', { name: 'Refresh saved copies' }).click();
    await expect(page.getByRole('button', { name: 'Open New name' })).toBeEnabled();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export GeoJSON for New name' }).click();
    const path = await (await pending).path(); expect(path).not.toBeNull();
    const { readFile } = await import('node:fs/promises');
    const geojson = JSON.parse((await readFile(path!)).toString());
    expect(geojson.features[0].geometry.coordinates).toEqual([90.4, 23.8]);
    await page.getByRole('button', { name: 'Open New name' }).click();
    await expect(page.getByText('1 completed feature')).toBeVisible();
  } finally { await other.close(); }
});

test('simulated quota failure during backup restore rolls back the whole batch and can be retried', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const confirmation = page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.');
  const create = async (name: string, longitude: number) => {
    const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, 23.8] }, properties: {} }] });
    await page.getByLabel('Name for imported project').fill(name);
    await page.getByLabel('GeoJSON file').setInputFiles({ name: `${name}.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(input) });
    await confirmation.check();
    await page.getByRole('button', { name: 'Import as new copy' }).click();
    await expect(page.getByRole('button', { name: `Open ${name}` })).toBeVisible();
  };
  await create('Recovery A', 90.4); await create('Recovery B', 90.5);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
  const path = await (await pending).path(); expect(path).not.toBeNull();
  const { readFile } = await import('node:fs/promises'); const backup = await readFile(path!);
  for (const name of ['Recovery A', 'Recovery B']) {
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: `Delete ${name}` }).click();
    await expect(page.getByRole('button', { name: `Open ${name}` })).toHaveCount(0);
  }
  await create('Unrelated copy', 90.6);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    let writes = 0;
    Object.assign(window, { restoreOriginalAdd: () => { IDBObjectStore.prototype.add = original; } });
    IDBObjectStore.prototype.add = function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'projects' && this.transaction.db.name === 'land-expert-projects' && ++writes === 2) throw new DOMException('Simulated quota exceeded', 'QuotaExceededError');
      return Reflect.apply(original, this, args);
    };
  });
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Restore backup file').setInputFiles({ name: 'recovery.json', mimeType: 'application/json', buffer: backup });
  await expect(page.getByRole('alert')).toContainText('Restore failed');
  await page.getByRole('button', { name: 'Refresh saved copies' }).click();
  await expect(page.getByRole('button', { name: 'Open Recovery A' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Recovery B' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Unrelated copy' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { restoreOriginalAdd: () => void }).restoreOriginalAdd());
  page.once('dialog', dialog => dialog.accept());
  await page.getByLabel('Restore backup file').setInputFiles({ name: 'recovery.json', mimeType: 'application/json', buffer: backup });
  await expect(page.getByText('Backup restored to this browser.')).toBeVisible();
  for (const name of ['Recovery A', 'Recovery B', 'Unrelated copy']) await expect(page.getByRole('button', { name: `Open ${name}` })).toBeVisible();
});

test('a backup recovers a project in a new isolated browser context', async ({ browser }) => {
  const first = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  let backup: Buffer;
  try {
    const page = await first.newPage(); await page.goto('/survey');
    await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
    const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
    await page.getByLabel('Name for imported project').fill('Portable copy');
    await page.getByLabel('GeoJSON file').setInputFiles({ name: 'land.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
    await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
    await page.getByRole('button', { name: 'Import as new copy' }).click();
    await expect(page.getByRole('button', { name: 'Open Portable copy' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open Portable copy' })).toBeVisible();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Back up Portable copy' }).click();
    const path = await (await pending).path(); if (!path) throw new Error('Backup unavailable');
    const { readFile } = await import('node:fs/promises'); backup = await readFile(path);
  } finally { await first.close(); }
  const second = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  try {
    const page = await second.newPage(); await page.goto('/survey');
    await expect(page.getByText('No saved project copies yet.')).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.getByLabel('Restore backup file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
    await expect(page.getByText('Backup restored to this browser.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Portable copy' })).toBeEnabled();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export GeoJSON for Portable copy' }).click();
    const path = await (await pending).path(); if (!path) throw new Error('Export unavailable');
    const { readFile } = await import('node:fs/promises');
    const result = JSON.parse((await readFile(path)).toString());
    expect(result.features[0].geometry.coordinates).toEqual([90.4, 23.8]);
    await page.getByRole('button', { name: 'Open Portable copy' }).click();
    await expect(page.getByText('1 completed feature')).toBeVisible();
  } finally { await second.close(); }
});

test('downloads a maximum-size English PDF and rejects one coordinate over the limit', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const coordinates = (count: number, lat: number) => Array.from({ length: count }, (_, i) => [90 + i / 10000, lat]);
  const lines = [coordinates(2000, 23), coordinates(2000, 24), coordinates(1000, 25)];
  const create = async (name: string, features: number[][][]) => {
    const input = JSON.stringify({ type: 'FeatureCollection', features: features.map(coordinates => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} })) });
    await page.getByLabel('Name for imported project').fill(name);
    await page.getByLabel('GeoJSON file').setInputFiles({ name: `${name}.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(input) });
    await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
    await page.getByRole('button', { name: 'Import as new copy' }).click();
    await expect(page.getByRole('button', { name: `Download PDF for ${name}` })).toBeEnabled();
  };
  await create('Maximum PDF', lines);
  const pending = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Download PDF for Maximum PDF' }).click();
  const path = await (await pending).path(); if (!path) throw new Error('PDF unavailable');
  const { readFile } = await import('node:fs/promises'); const data = await readFile(path);
  expect(data.subarray(0, 5).toString()).toBe('%PDF-');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false }).promise;
  try {
    expect(doc.numPages).toBeGreaterThan(1);
    const extracted: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pdfPage = await doc.getPage(i); const text = await pdfPage.getTextContent();
      extracted.push(...text.items.map(item => 'str' in item ? item.str : '')); pdfPage.cleanup();
    }
    const text = extracted.join(' ');
    expect(text).toContain('Maximum PDF'); expect(text).toContain('spherical estimates');
    const found = [...text.matchAll(/\b(23|24|25), (90(?:\.\d+)?)(?![\d.])/g)].map(m => `${m[1]}, ${m[2]}`);
    const expected = lines.flatMap(line => line.map(([lon, lat]) => `${lat}, ${Number(lon.toFixed(6))}`));
    expect(found).toEqual(expected);
  } finally { await doc.cleanup(); }
  await create('Over limit PDF', [lines[0], lines[1], coordinates(1001, 25)]);
  await page.getByRole('button', { name: 'Download PDF for Over limit PDF' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not generate the PDF');
  await expect(page.getByRole('button', { name: 'Download PDF for Maximum PDF' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Open Over limit PDF' })).toBeEnabled();
});

test('rejects malformed UTF-8 in import and backup without changing saved data', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: { note: 'X' } }] });
  const badInput = Buffer.from(input); badInput[badInput.indexOf('"X"') + 1] = 0xff;
  const file = page.getByLabel('GeoJSON file');
  const confirmCrs = page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.');
  await page.getByLabel('Name for imported project').fill('FieldX');
  await file.setInputFiles({ name: 'bad.geojson', mimeType: 'application/geo+json', buffer: badInput });
  await confirmCrs.check(); await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('alert')).toContainText('Import failed');
  await expect(page.getByText('No saved project copies yet.')).toBeVisible();
  await file.setInputFiles({ name: 'good.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await confirmCrs.check(); await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Open FieldX' })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up FieldX' }).click();
  const path = await (await pending).path(); if (!path) throw new Error('Backup unavailable');
  const { readFile } = await import('node:fs/promises');
  const backup = await readFile(path); const corrupt = Buffer.from(backup);
  const nameIndex = corrupt.indexOf('FieldX'); expect(nameIndex).toBeGreaterThan(-1); corrupt[nameIndex + 5] = 0xff;
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete FieldX' }).click();
  await expect(page.getByText('No saved project copies yet.')).toBeVisible();
  await page.getByLabel('Check backup file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: corrupt });
  await expect(page.getByText(/Backup check failed/)).toBeVisible();
  let confirmations = 0; page.on('dialog', dialog => { confirmations++; void dialog.dismiss(); });
  await page.getByLabel('Restore backup file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: corrupt });
  await expect(page.getByText(/Restore failed/)).toBeVisible();
  expect(confirmations).toBe(0);
  await expect(page.getByText('No saved project copies yet.')).toBeVisible();
});

test('backup check and restore reject noncanonical names instead of silently changing them', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  const input = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [90.4, 23.8] }, properties: {} }] });
  await page.getByLabel('Name for imported project').fill('Name check');
  await page.getByLabel('GeoJSON file').setInputFiles({ name: 'land.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(input) });
  await page.getByLabel('I verified this file uses WGS84 longitude and latitude. The app cannot verify the source CRS.').check();
  await page.getByRole('button', { name: 'Import as new copy' }).click();
  await expect(page.getByRole('button', { name: 'Open Name check' })).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up Name check' }).click();
  const path = await (await pending).path(); if (!path) throw new Error('Backup unavailable');
  const { readFile } = await import('node:fs/promises');
  const backup = JSON.parse((await readFile(path)).toString());
  backup.projects[0].name = ' Name check ';
  const changed = Buffer.from(JSON.stringify(backup));
  await page.getByLabel('Check backup file').setInputFiles({ name: 'noncanonical.json', mimeType: 'application/json', buffer: changed });
  await expect(page.getByText(/Backup check failed/)).toBeVisible();
  let confirmations = 0; page.on('dialog', dialog => { confirmations++; void dialog.dismiss(); });
  await page.getByLabel('Restore backup file').setInputFiles({ name: 'noncanonical.json', mimeType: 'application/json', buffer: changed });
  await expect(page.getByText(/Restore failed/)).toBeVisible();
  expect(confirmations).toBe(0);
  await expect(page.getByRole('button', { name: 'Open Name check' })).toBeVisible();
});


test('opt-in map catalog loads tiles with attribution and preserves drawing when switched', async ({ page }) => {
  let requests = 0;
  const { readFile } = await import('node:fs/promises');
  const png = await readFile(new URL('./fixtures/tile.png', import.meta.url));
  await page.route('https://tile.openstreetmap.org/**', async route => { requests++; await route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*' } }); });
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.locator('.survey-map canvas').click({ position: { x: 180, y: 180 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
  await page.getByLabel('Project name').fill('Before map change');
  await page.getByRole('button', { name: 'Save copy' }).click();
  await expect(page.getByRole('button', { name: 'Open Before map change' })).toBeVisible();
  await page.getByLabel('Basemap', { exact: true }).selectOption('osm');
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  await expect(page.getByText('1 completed feature')).toBeVisible();
  await page.getByLabel('Basemap', { exact: true }).selectOption('grid');
  await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toHaveCount(0);
  await expect(page.getByText('1 completed feature')).toBeVisible();
  await page.getByLabel('Project name').fill('Map change');
  await page.getByRole('button', { name: 'Save copy' }).click();
  await expect(page.getByRole('button', { name: 'Open Map change' })).toBeVisible();
  const read = async (name: string) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: `Export GeoJSON for ${name}` }).click();
    const path = await (await download).path(); if (!path) throw new Error('Export unavailable');
    return JSON.parse((await readFile(path)).toString()).features[0].geometry;
  };
  expect(await read('Map change')).toEqual(await read('Before map change'));
});

test('failed online tiles do not block the drawing editor and the grid remains available', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', route => route.abort('failed'));
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await page.getByLabel('Basemap', { exact: true }).selectOption('osm');
  await expect(page.getByRole('alert')).toContainText('Map tiles could not be loaded');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.locator('.survey-map canvas').click({ position: { x: 180, y: 180 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
  await page.getByLabel('Basemap', { exact: true }).selectOption('grid');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('1 completed feature')).toBeVisible();
});

test('map catalog controls and attribution fit supported viewport sizes in both languages', async ({ page }) => {
  const { readFile } = await import('node:fs/promises');
  const png = await readFile(new URL('./fixtures/tile.png', import.meta.url));
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await page.locator('#basemap-select').selectOption('osm');
  for (const language of ['en', 'bn']) {
    await page.locator('#header-language').selectOption(language);
    for (const width of [320, 375, 430, 768, 1024, 1366, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.locator('#basemap-select')).toBeVisible();
      await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});

test('deployment catalog selects a configured provider with attribution and no default tile requests', async ({ page }) => {
  const { readFile } = await import('node:fs/promises');
  const png = await readFile(new URL('./fixtures/tile.png', import.meta.url));
  const config = { version: 1, allowCommunityOsm: false, providers: [{ id: 'licensed-map', name: 'Licensed map', tileUrl: 'https://tiles.example.com/{z}/{x}/{y}.png', tileSize: 256, maxZoom: 19, attribution: '© Example map provider', attributionUrl: 'https://example.com/attribution' }] };
  await page.route('**/map-catalog.json', route => route.fulfill({ json: config }));
  let count = 0;
  await page.route('https://tiles.example.com/**', route => { count++; return route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*' } }); });
  await page.goto('/survey');
  await expect(page.getByLabel('Basemap', { exact: true })).toBeEnabled();
  await expect(page.locator('#basemap-select option[value="osm"]')).toHaveCount(0);
  expect(count).toBe(0);
  await page.getByLabel('Basemap', { exact: true }).selectOption('licensed-map');
  await expect.poll(() => count).toBeGreaterThan(0);
  await expect(page.getByRole('link', { name: '© Example map provider' })).toHaveAttribute('href', 'https://example.com/attribution');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await page.getByLabel('Basemap', { exact: true }).selectOption('grid');
  await expect(page.getByRole('link', { name: '© Example map provider' })).toHaveCount(0);
});

test('invalid deployment catalog fails closed to the usable grid', async ({ page }) => {
  await page.route('**/map-catalog.json', route => route.fulfill({ json: { version: 1, allowCommunityOsm: false, providers: [{ id: 'bad', name: 'Bad', tileUrl: 'http://example.com/{z}/{x}/{y}' }] } }));
  await page.goto('/survey');
  await expect(page.getByRole('alert')).toContainText('Online map catalog could not be loaded');
  await expect(page.getByLabel('Basemap', { exact: true })).toHaveValue('grid');
  await expect(page.locator('#basemap-select option')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.locator('.survey-map canvas').click({ position: { x: 180, y: 180 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
});

test('switching configured providers preserves in-progress drawing and updates attribution', async ({ page }) => {
  const { readFile } = await import('node:fs/promises');
  const png = await readFile(new URL('./fixtures/tile.png', import.meta.url));
  await page.route('**/map-catalog.json', route => route.fulfill({ json: { version: 1, allowCommunityOsm: true, providers: [{ id: 'other', name: 'Other tiles', tileUrl: 'https://tiles.example.com/{z}/{x}/{y}.png', tileSize: 256, maxZoom: 19, attribution: 'Other attribution', attributionUrl: 'https://example.com/terms' }] } }));
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*' } }));
  await page.route('https://tiles.example.com/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Line', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Line', exact: true }).click();
  await page.locator('.survey-map canvas').click({ position: { x: 150, y: 150 } });
  await expect(page.getByRole('button', { name: 'Cancel drawing' })).toBeEnabled();
  await page.getByLabel('Basemap', { exact: true }).selectOption('osm');
  await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toBeVisible();
  await page.getByLabel('Basemap', { exact: true }).selectOption('other');
  await expect(page.getByRole('link', { name: 'Other attribution' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel drawing' })).toBeEnabled();
  await page.locator('.survey-map canvas').click({ position: { x: 250, y: 200 } });
  await page.keyboard.press('Enter');
  await expect(page.getByText('1 completed feature')).toBeVisible();
});

test('online map controls and attribution remain usable in landscape', async ({ page }) => {
  const { readFile } = await import('node:fs/promises');
  const png = await readFile(new URL('./fixtures/tile.png', import.meta.url));
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await page.locator('#basemap-select').selectOption('osm');
  for (const size of [{ width: 667, height: 375 }, { width: 932, height: 430 }]) {
    await page.setViewportSize(size);
    await expect(page.locator('#basemap-select')).toBeVisible();
    await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('a stalled deployment catalog times out without disabling the drawing editor', async ({ page }) => {
  await page.route('**/map-catalog.json', async route => {
    await new Promise(resolve => setTimeout(resolve, 10000));
    await route.abort().catch(() => {});
  });
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toContainText('Online map catalog could not be loaded', { timeout: 12000 });
  await expect(page.getByLabel('Basemap', { exact: true })).toHaveValue('grid');
  await expect(page.getByLabel('Basemap', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.locator('.survey-map canvas').click({ position: { x: 180, y: 180 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
});

test('going offline returns to grid and preserves work', async ({ page, context }) => {
  const { readFile } = await import('node:fs/promises');
  const png = await readFile(new URL('./fixtures/tile.png', import.meta.url));
  let requests = 0;
  await page.route('https://tile.openstreetmap.org/**', route => { requests++; return route.fulfill({ status: 200, contentType: 'image/png', body: png, headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=604800' } }); });
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.locator('.survey-map canvas').click({ position: { x: 180, y: 180 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
  await page.getByLabel('Basemap', { exact: true }).selectOption('osm');
  await expect.poll(() => requests).toBeGreaterThan(0);
  await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toBeVisible();
  try {
    await context.setOffline(true);
    await expect(page.getByLabel('Basemap', { exact: true })).toHaveValue('grid');
    await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('Map tiles could not be loaded');
    await expect(page.getByText('1 completed feature')).toBeVisible();
    await page.getByLabel('Basemap', { exact: true }).selectOption('osm');
    await expect(page.getByLabel('Basemap', { exact: true })).toHaveValue('grid');
    await expect(page.getByText('1 completed feature')).toBeVisible();
  } finally { await context.setOffline(false); }
  await page.getByLabel('Basemap', { exact: true }).selectOption('osm');
  await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toBeVisible();
});
