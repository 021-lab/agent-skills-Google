import { test, expect } from '@playwright/test';

test('Voice Notes waits for delayed bootstrap config before mounting auth UI', async ({ page }) => {
  await page.goto('/tests/fixtures/voice-notes-bootstrap/index.html');
  await page.waitForFunction(() => window.__voiceNotesApp && window.__voiceNotesApp.ui);

  await expect.poll(async () => {
    return page.locator('#voiceframe-ui').evaluate((host) => {
      return host.shadowRoot.getElementById('sign-in-btn').textContent;
    });
  }).toBe('Sign in');

  await page.locator('#voiceframe-ui').evaluate((host) => {
    host.shadowRoot.getElementById('sign-in-btn').click();
  });

  await expect.poll(async () => {
    return page.locator('#voiceframe-ui').evaluate((host) => {
      return host.shadowRoot.getElementById('auth-status').textContent;
    });
  }).toBe('owner@example.com');
});
