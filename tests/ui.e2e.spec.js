// E2E: proves the injected UI chrome (Undo button, Log tab, mic indicator)
// actually renders and works in a real browser via VoiceApp's default mount
// (config.ui defaults to true). Reuses the emulate fixture, whose app.js
// calls VoiceApp.init({ debug: true }) with no ui: false override.
import { test, expect } from '@playwright/test';

test('UI chrome mounts and the Undo button starts disabled', async ({ page }) => {
  await page.goto('/tests/fixtures/emulate/index.html');
  await page.waitForFunction(() => window.__voiceframeApp && window.__voiceframeApp.ui);

  const host = page.locator('#voiceframe-ui');
  await expect(host).toBeAttached();

  const undoDisabled = await page.evaluate(() => window.__voiceframeApp.ui.elements.undoBtn.disabled);
  expect(undoDisabled).toBe(true);
});

test('UI chrome: Undo button enables after a mutation and reverses it on click', async ({ page }) => {
  await page.goto('/tests/fixtures/emulate/index.html');
  await page.waitForFunction(() => window.__voiceframe && typeof window.__voiceframe.emulate === 'function');

  await page.evaluate(async () => {
    await window.__voiceframe.emulate({ selector: '#record', type: 'say', transcript: 'buy milk' });
  });

  const enabledAfterCommand = await page.evaluate(() => !window.__voiceframeApp.ui.elements.undoBtn.disabled);
  expect(enabledAfterCommand).toBe(true);

  const itemsBeforeUndo = await page.evaluate(() => window.__testState.items.length);
  expect(itemsBeforeUndo).toBe(1);

  // Click the real Undo button inside the shadow root.
  await page.evaluate(() => window.__voiceframeApp.ui.elements.undoBtn.click());
  await page.waitForFunction(() => window.__voiceframeApp.ui.elements.undoBtn.disabled === true);

  const undoDepth = await page.evaluate(() => window.__voiceframeApp.undoStack.depth());
  expect(undoDepth).toBe(0);
});

test('UI chrome: Log tab toggles the panel and lists commands', async ({ page }) => {
  await page.goto('/tests/fixtures/emulate/index.html');
  await page.waitForFunction(() => window.__voiceframe && typeof window.__voiceframe.emulate === 'function');

  await page.evaluate(async () => {
    await window.__voiceframe.emulate({ selector: '#record', type: 'say', transcript: 'call mom' });
  });

  const panelHiddenBefore = await page.evaluate(() => window.__voiceframeApp.ui.elements.logPanel.hidden);
  expect(panelHiddenBefore).toBe(true);

  await page.evaluate(() => window.__voiceframeApp.ui.elements.logTab.click());

  const panelHiddenAfter = await page.evaluate(() => window.__voiceframeApp.ui.elements.logPanel.hidden);
  expect(panelHiddenAfter).toBe(false);

  const panelText = await page.evaluate(() => window.__voiceframeApp.ui.elements.logPanel.innerHTML);
  expect(panelText).toContain('call mom');
});

test('UI chrome: mic indicator reflects voice state transitions', async ({ page }) => {
  await page.goto('/tests/fixtures/emulate/index.html');
  await page.waitForFunction(() => window.__voiceframeApp && window.__voiceframeApp.ui);

  const idleClass = await page.evaluate(() => window.__voiceframeApp.ui.elements.micIndicator.className);
  expect(idleClass).toBe('idle');

  await page.evaluate(() => window.__voiceframeApp.ui.setMicState('listening'));
  const listeningClass = await page.evaluate(() => window.__voiceframeApp.ui.elements.micIndicator.className);
  expect(listeningClass).toBe('listening');
});
