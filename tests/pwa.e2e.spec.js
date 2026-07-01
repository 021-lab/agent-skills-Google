// E2E: proves the service worker registered by VoiceApp.init() caches
// same-origin assets cache-first and serves the page when offline (SPEC.md
// "Install modes" and "PWA limits on iOS"), and that manifest.webmanifest
// is linked and valid.
import { test, expect } from '@playwright/test';

test('manifest.webmanifest is linked and valid', async ({ page, request }) => {
  await page.goto('/tests/fixtures/pwa/index.html');

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href');
  expect(manifestHref).toBe('/src/pwa/manifest.webmanifest');

  const response = await request.get(manifestHref);
  expect(response.ok()).toBe(true);

  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  expect(typeof manifest.name).toBe('string');
  expect(Array.isArray(manifest.icons)).toBe(true);
});

test('service worker registers and reaches the active state', async ({ page }) => {
  await page.goto('/tests/fixtures/pwa/index.html');

  const active = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return reg.active !== null;
  });

  expect(active).toBe(true);
});

test('offline: a previously cached page still loads with the network cut off', async ({ page, context }) => {
  await page.goto('/tests/fixtures/pwa/index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);

  // Reload once online, under an active service worker, so cache-first
  // populates the cache for this page's own assets on the way through.
  await page.reload();
  await page.waitForSelector('#heading');

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator('#heading')).toHaveText('PWA Fixture');
  } finally {
    await context.setOffline(false);
  }
});
