// E2E: proves the sign-in button added to the UI chrome (src/core/ui.js)
// actually renders and works in a real browser — clicking it drives
// Auth.signInWithGooglePopup() through to a signed-in state, and the
// button/status text update accordingly. Still not a real Google network
// call (the fixture's firebase.auth mock simulates the popup resolving);
// see tests/google-sdk.test.js for the adapter-logic tests and
// examples/voice-notes/REAL-KEYS.md for what remains unverified without
// real credentials.
import { test, expect } from '@playwright/test';

test('sign-in button renders and starts in signed-out state', async ({ page }) => {
  await page.goto('/tests/fixtures/signin/index.html');
  await page.waitForFunction(() => window.__voiceframeApp && window.__voiceframeApp.ui);

  const signInText = await page.evaluate(() => window.__voiceframeApp.ui.elements.signInBtn.textContent);
  expect(signInText).toBe('Sign in');

  const authGate = await page.evaluate(() => {
    try {
      window.__voiceframeApp.auth.requireAuth();
      return 'allowed';
    } catch (err) {
      return err.message;
    }
  });
  expect(authGate).toMatch(/Authentication required/);
});

test('clicking sign-in drives a real popup-shaped flow to signed-in state', async ({ page }) => {
  await page.goto('/tests/fixtures/signin/index.html');
  await page.waitForFunction(() => window.__voiceframeApp && window.__voiceframeApp.ui);

  await page.evaluate(() => window.__voiceframeApp.ui.elements.signInBtn.click());
  await page.waitForFunction(() => window.__voiceframeApp.ui.elements.signInBtn.textContent === 'Sign out');

  const status = await page.evaluate(() => window.__voiceframeApp.ui.elements.authStatus.textContent);
  expect(status).toBe('owner@example.com');

  const isSignedIn = await page.evaluate(() => window.__voiceframeApp.auth.isSignedIn());
  expect(isSignedIn).toBe(true);
});

test('after sign-in, a command reaches the app handler; after sign-out, it is blocked again', async ({ page }) => {
  await page.goto('/tests/fixtures/signin/index.html');
  await page.waitForFunction(() => window.__voiceframeApp && window.__voiceframeApp.ui);

  let handled = false;
  await page.exposeFunction('__markHandled', () => { handled = true; });

  await page.evaluate(() => {
    window.__voiceframeApp.handle(async () => { await window.__markHandled(); });
  });

  await page.evaluate(() => window.__voiceframeApp.ui.elements.signInBtn.click());
  await page.waitForFunction(() => window.__voiceframeApp.auth.isSignedIn() === true);

  await page.evaluate(async () => {
    await window.__voiceframeApp.emulate({ selector: 'body', type: 'tap' });
  });
  expect(handled).toBe(true);

  // Sign out via the same button, then confirm the gate closes again.
  await page.evaluate(() => window.__voiceframeApp.ui.elements.signInBtn.click());
  await page.waitForFunction(() => window.__voiceframeApp.auth.isSignedIn() === false);

  const rejected = await page.evaluate(async () => {
    try {
      await window.__voiceframeApp.emulate({ selector: 'body', type: 'tap' });
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
});
