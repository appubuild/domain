import { test, expect } from '@playwright/test';

test('GPS requests permission only on demand and provides an accurate one-time display', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 23.8, longitude: 90.4, accuracy: 17 });
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { value: (...args: Parameters<Geolocation['getCurrentPosition']>) => {
      (window as unknown as { gpsRequests: number }).gpsRequests++;
      return original(...args);
    }});
    (window as unknown as { gpsRequests: number }).gpsRequests = 0;
  });
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { gpsRequests: number }).gpsRequests)).toBe(0);
  await page.getByRole('button', { name: 'Get current location' }).click();
  await expect(page.getByText(/23.8°, 90.4°/)).toBeVisible();
  await expect(page.getByText('Reported accuracy: ±17 m (device estimate)')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { gpsRequests: number }).gpsRequests)).toBe(1);
  await page.getByRole('button', { name: 'Center map on location' }).click();
  await page.getByRole('button', { name: 'Clear location' }).click();
  await expect(page.getByText(/23.8°, 90.4°/)).toHaveCount(0);
});

test('GPS permission denial is visible and does not block drawing', async ({ page, context }) => {
  await context.grantPermissions([]);
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Get current location' }).click();
  await expect(page.getByRole('alert')).toContainText('Location permission was denied');
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.locator('.survey-map canvas').click({ position: { x: 180, y: 180 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
});

test('local image is aligned to manual bounds, preserves drawing, and can be removed', async ({ page }) => {
  const blue = await (await import('node:fs/promises')).readFile(new URL('./fixtures/blue-tile.png', import.meta.url));
  await page.route('https://tile.openstreetmap.org/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: blue, headers: { 'access-control-allow-origin': '*' } }));
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Point', exact: true }).click();
  await page.locator('.survey-map canvas').click({ position: { x: 180, y: 180 } });
  await expect(page.getByText('1 completed feature')).toBeVisible();
  const png = await (await import('node:fs/promises')).readFile(new URL('./fixtures/tile.png', import.meta.url));
  await page.getByLabel('Reference image (PNG or JPEG)').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: png });
  for (const [label, value] of [['West longitude','90.3'],['East longitude','90.5'],['South latitude','23.7'],['North latitude','23.9']]) await page.getByLabel(label).fill(value);
  await page.getByRole('button', { name: 'Place image on map' }).click();
  await expect(page.getByText('Reference image placed. It is temporary and is not saved with the project.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeEnabled();
  const centerPixel = async () => {
    const image = await page.locator('.survey-map').screenshot({ animations: 'disabled' });
    return page.evaluate(async bytes => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = bmp.width; canvas.height = bmp.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bmp, 0, 0); bmp.close();
      return [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
    }, Array.from(image));
  };
  // Actual raster pixels are rendered, and remain above a different-coloured basemap.
  await expect.poll(async () => (await centerPixel())[0]).toBeLessThan(210);
  await page.getByLabel('Basemap', { exact: true }).selectOption('osm');
  await expect(page.getByRole('link', { name: 'OpenStreetMap', exact: true })).toBeVisible();
  await expect.poll(async () => (await centerPixel())[2]).toBeLessThan(190);
  await page.getByLabel('Basemap', { exact: true }).selectOption('grid');
  await expect(page.getByText('1 completed feature')).toBeVisible();
  await page.getByLabel('West longitude').fill('91');
  await page.getByRole('button', { name: 'Place image on map' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid bounds');
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeEnabled();
  await page.getByLabel('West longitude').fill('90.3');
  await page.getByLabel('Reference image (PNG or JPEG)').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await page.getByRole('button', { name: 'Place image on map' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not place the image');
  await expect.poll(async () => (await centerPixel())[0]).toBeLessThan(210);
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeEnabled();
  const jpgBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#d09030'; ctx.fillRect(0, 0, 16, 16);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  await page.getByLabel('Reference image (PNG or JPEG)').setInputFiles({ name: 'image.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpgBase64, 'base64') });
  await page.getByRole('button', { name: 'Place image on map' }).click();
  await expect(page.getByText('Reference image placed. It is temporary and is not saved with the project.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove image' }).click();
  await expect.poll(async () => (await centerPixel())[0]).toBeGreaterThan(210);
  await expect(page.getByRole('button', { name: 'Remove image' })).toBeDisabled();
  await expect(page.getByText('1 completed feature')).toBeVisible();
});

test('stale GPS coordinates are displayed but cannot recenter the map', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (success: PositionCallback) => success({ coords: { latitude: 23.8, longitude: 90.4, accuracy: 50 }, timestamp: Date.now() - 61000 } as GeolocationPosition) } });
  });
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Get current location' }).click();
  await expect(page.getByText(/over 60 seconds old/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Center map on location' })).toBeDisabled();
});

test('location and reference controls fit supported screen and landscape widths in both languages', async ({ page }) => {
  await page.goto('/survey');
  await expect(page.getByRole('button', { name: 'Point', exact: true })).toBeEnabled();
  for (const language of ['en', 'bn']) {
    await page.locator('#header-language').selectOption(language);
    for (const width of [320, 375, 430, 768, 1024, 1366, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.locator('#georef-image')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    for (const size of [{ width: 667, height: 375 }, { width: 932, height: 430 }]) {
      await page.setViewportSize(size);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
