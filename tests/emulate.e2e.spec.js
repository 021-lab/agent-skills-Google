// E2E: proves the agent-emulation API drives a real page in a real browser
// through the exact same handler as live user input (SPEC.md "The
// agent-emulation API" and "Testing Strategy"). WebKit is the target engine
// per SPEC.md to match iOS Safari; see playwright.config.js for why this
// sandbox substitutes Chromium.
import { test, expect } from '@playwright/test';

test('emulate() dispatches a say command through the same handler as user input', async ({ page }) => {
  await page.goto('/tests/fixtures/emulate/index.html');
  await page.waitForFunction(() => window.__voiceframe && typeof window.__voiceframe.emulate === 'function');

  const result = await page.evaluate(async () => {
    return window.__voiceframe.emulate({
      selector: '#record',
      type: 'say',
      transcript: 'buy milk',
    });
  });

  expect(result.success).toBe(true);
  expect(result.context.transcript).toBe('buy milk');

  // Stand-in for "assert the resulting Firestore/Drive state" per SPEC.md —
  // this fixture has no real Firebase/Drive backend, so we assert the
  // observable DOM state the handler produced instead.
  const itemText = await page.textContent('[data-testid="item"]');
  expect(itemText).toBe('buy milk');

  const items = await page.evaluate(() => window.__testState.items);
  expect(items).toEqual(['buy milk']);
});

test('emulate() throws for a selector that does not exist on the page', async ({ page }) => {
  await page.goto('/tests/fixtures/emulate/index.html');
  await page.waitForFunction(() => window.__voiceframe && typeof window.__voiceframe.emulate === 'function');

  const error = await page.evaluate(async () => {
    try {
      await window.__voiceframe.emulate({ selector: '#does-not-exist', type: 'tap' });
      return null;
    } catch (err) {
      return err.message;
    }
  });

  expect(error).toMatch(/Element not found/);
});

test('emulate() logs every command; a voice correction serializes into a replayable fixture', async ({ page }) => {
  await page.goto('/tests/fixtures/emulate/index.html');
  await page.waitForFunction(() => window.__voiceframe && typeof window.__voiceframe.emulate === 'function');

  await page.evaluate(async () => {
    await window.__voiceframe.emulate({ selector: '#record', type: 'say', transcript: 'buy milk' });
  });

  const fixture = await page.evaluate(async () => {
    const entries = window.__voiceframeApp.commandLog.getEntries();
    const entry = entries[entries.length - 1];
    return window.__voiceframeApp.commandLog.correct(entry.id, {
      transcript: 'buy milk and eggs',
      expected: { items: ['buy milk and eggs'] },
    });
  });

  expect(fixture.selector).toBe('#record');
  expect(fixture.type).toBe('say');
  expect(fixture.transcript).toBe('buy milk and eggs');
  expect(fixture.expected).toEqual({ items: ['buy milk and eggs'] });
});

test('emulate() replays a fixture and reproduces the original command', async ({ page }) => {
  await page.goto('/tests/fixtures/emulate/index.html');
  await page.waitForFunction(() => window.__voiceframe && typeof window.__voiceframe.emulate === 'function');

  // A fixture as it would be persisted under issues/NNNN-*.fixture.json.
  const fixture = { selector: '#record', type: 'say', transcript: 'call mom' };

  await page.evaluate(async (f) => {
    await window.__voiceframe.emulate(f);
  }, fixture);

  const items = await page.evaluate(() => window.__testState.items);
  expect(items).toEqual(['call mom']);
});
