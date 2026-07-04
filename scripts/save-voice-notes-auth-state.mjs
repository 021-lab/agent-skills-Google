import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { chromium } from '@playwright/test';

import { resolveVoiceNotesE2EUrl } from './voice-notes-e2e-config.mjs';

async function main() {
  const outputPath = resolve(process.env.E2E_STORAGE_STATE_PATH || 'playwright/.auth/voice-notes-google.json');
  const authUrl = resolveVoiceNotesE2EUrl({
    projectId: process.env.FIREBASE_PROJECT_ID,
    url: process.env.E2E_AUTH_URL,
  });

  mkdirSync(dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`Opening ${authUrl}`);
    await page.goto(authUrl);
    await page.waitForFunction(() => window.__voiceNotesApp && window.__voiceNotesApp.auth && window.__voiceNotesApp.ui);

    const alreadySignedIn = await page.evaluate(() => window.__voiceNotesApp.auth.isSignedIn());
    if (!alreadySignedIn) {
      console.log('Browser is ready. Complete Google sign-in in the opened window.');
      await page.locator('#sign-in-btn').click();
    } else {
      console.log('Existing signed-in session detected. Saving it directly.');
    }

    await page.waitForFunction(() => window.__voiceNotesApp.auth.isSignedIn() === true, null, { timeout: 300000 });

    const signedInEmail = await page.evaluate(() => window.__voiceNotesApp.auth.getUser()?.email ?? null);
    console.log(`Signed in as: ${signedInEmail || '(unknown email)'}`);

    await context.storageState({ path: outputPath });
    console.log(`Saved Playwright storageState to ${outputPath}`);
    console.log('Next step: run `npm run e2e:auth:upload-secret` to push the session into GitHub Actions.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
