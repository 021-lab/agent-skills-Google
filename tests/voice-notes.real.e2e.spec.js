// Real deployed smoke test for GitHub Actions. Unlike voice-notes.e2e.spec.js,
// this does not install mocks: the deployed page loads firebase-config.js,
// signs in with a real allowlisted Google account, then exercises Gemini +
// Drive through the Voice Notes handler.
import { test, expect } from '@playwright/test';

const REAL_E2E_ENABLED = process.env.E2E_REAL === '1';
const REQUIRED_ENV = ['E2E_BASE_URL', 'E2E_GOOGLE_EMAIL', 'E2E_GOOGLE_PASSWORD'];

test.skip(!REAL_E2E_ENABLED, 'Set E2E_REAL=1 to run deployed real-integration tests');

function requireRealEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required real E2E env vars: ${missing.join(', ')}`);
  }
}

async function fillIfVisible(page, selector, value) {
  const field = page.locator(selector).first();
  if (await field.isVisible({ timeout: 5000 }).catch(() => false)) {
    await field.fill(value);
    return true;
  }
  return false;
}

async function clickIfVisible(page, selector) {
  const button = page.locator(selector).first();
  if (await button.isVisible({ timeout: 5000 }).catch(() => false)) {
    await button.click();
    return true;
  }
  return false;
}

async function completeGooglePopupLogin(popup) {
  await popup.waitForLoadState('domcontentloaded');

  const emailFilled = await fillIfVisible(popup, 'input[type="email"]', process.env.E2E_GOOGLE_EMAIL);
  if (emailFilled) {
    await clickIfVisible(popup, '#identifierNext button, button:has-text("Next"), button:has-text("Далее")');
  }

  await fillIfVisible(popup, 'input[type="password"]', process.env.E2E_GOOGLE_PASSWORD);
  await clickIfVisible(popup, '#passwordNext button, button:has-text("Next"), button:has-text("Далее")');

  await clickIfVisible(popup, 'button:has-text("Continue"), button:has-text("Продолжить")');
  await clickIfVisible(popup, 'button:has-text("Allow"), button:has-text("Разрешить")');
}

test('deployed Voice Notes signs in and records a real note', async ({ page }) => {
  requireRealEnv();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/examples/voice-notes/index.html');
  await page.waitForFunction(() => window.__voiceNotesApp && window.__voiceNotesApp.ui);

  const bootstrapState = await page.evaluate(() => window.__voiceNotesBootstrap || null);
  const authReady = await page.evaluate(() => Boolean(window.__voiceNotesApp.auth));
  expect(
    authReady,
    `Voice Notes app initialized without auth. Bootstrap: ${JSON.stringify(bootstrapState)}. Page errors: ${pageErrors.join(' | ')}`
  ).toBe(true);

  if (!(await page.evaluate(() => window.__voiceNotesApp.auth.isSignedIn()))) {
    const popupPromise = page.waitForEvent('popup');
    await page.locator('#sign-in-btn').click();
    const popup = await popupPromise;
    await completeGooglePopupLogin(popup);
  }

  await page.waitForFunction(() => window.__voiceNotesApp.auth.isSignedIn() === true, null, { timeout: 60000 });

  const transcript = `GitHub Actions real smoke test note ${Date.now()}`;
  await page.evaluate(async (spokenText) => {
    await window.__voiceNotesApp.emulate({
      selector: '#record',
      type: 'say',
      transcript: spokenText,
    });
  }, transcript);

  const latestEntry = await page.evaluate(() => {
    const entries = window.__voiceNotesApp.commandLog.getEntries();
    return entries[entries.length - 1];
  });

  expect(latestEntry.transcript).toBe(transcript);
  expect(latestEntry.detail.title).toEqual(expect.any(String));
  expect(latestEntry.detail.title.length).toBeGreaterThan(0);
});
