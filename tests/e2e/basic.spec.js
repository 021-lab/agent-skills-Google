import { test, expect } from '@playwright/test';

test.describe('Voice Framework E2E', () => {
  test('should load homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Voice Web Framework');
  });

  test('should display header', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('h1');
    await expect(header).toContainText('Voice Web Framework');
  });

  test('should have status indicators', async ({ page }) => {
    await page.goto('/');
    const status = page.locator('.status');
    await expect(status).toBeVisible();
  });

  test('should load voiceframe module', async ({ page }) => {
    await page.goto('/');

    // Check that VoiceApp was loaded via console
    const logs = [];
    page.on('console', (msg) => {
      logs.push(msg.text());
    });

    // Wait for initialization logs
    await page.waitForTimeout(500);

    // Check that framework initialized
    const initLog = logs.some((log) =>
      log.includes('Voice Framework initialized') ||
      log.includes('VoiceApp:')
    );
    expect(initLog).toBeTruthy();
  });

  test('should be responsive on mobile (iPhone)', async ({ browser }) => {
    const iphone = await browser.newContext({
      ...require('@playwright/test').devices['iPhone 12'],
    });

    const page = await iphone.newPage();
    await page.goto('/');
    await expect(page).toHaveTitle('Voice Web Framework');

    const header = page.locator('h1');
    await expect(header).toBeVisible();

    await page.close();
    await iphone.close();
  });
});
