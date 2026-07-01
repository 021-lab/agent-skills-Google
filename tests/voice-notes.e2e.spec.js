// E2E: the framework's acceptance test (SPEC.md "Acceptance Test — Voice
// Notes app"). Drives the deployed-shape app via the emulation API and
// asserts the resulting Drive state: recording a note produces two titled
// files (audio + transcript), both named from a Gemini summary of the
// transcript.
import { test, expect } from '@playwright/test';

// Runs inside the browser context via page.addInitScript(); builds mock
// Firebase auth (pre-signed-in), Gemini, and Drive clients compatible with
// the shapes voiceframe.js's auth.js/ai.js/drive.js expect, and installs
// them as window.__voiceNotesConfig before app.js reads it.
function installMockConfig() {
  function mockFirebase(user) {
    const listeners = [];
    return {
      auth: {
        onAuthStateChanged(cb) {
          listeners.push(cb);
          cb(user);
        },
        async signInWithCredential(credential) {
          listeners.forEach((l) => l(credential.user));
          return { user: credential.user };
        },
        async signOut() {
          listeners.forEach((l) => l(null));
        },
      },
    };
  }

  function mockGeminiClient() {
    return {
      async generate({ prompt }) {
        // Mimic Gemini's one-line summarization for the Voice Notes titles.
        const match = prompt.match(/\n\n([\s\S]+)$/);
        const source = match ? match[1] : prompt;
        const words = source.trim().split(/\s+/).slice(0, 4).join(' ');
        return { text: words.replace(/[.,!?]$/, '') };
      },
    };
  }

  function mockDriveClient() {
    const folders = new Map();
    const files = new Map();
    let nextId = 1;
    window.__mockDriveFiles = files;
    return {
      async findFolder({ name, parentId }) {
        return folders.get(`${parentId ?? 'root'}/${name}`) || null;
      },
      async createFolder({ name, parentId }) {
        const folder = { id: `folder-${nextId++}`, name };
        folders.set(`${parentId ?? 'root'}/${name}`, folder);
        return folder;
      },
      async uploadFile({ name, mimeType, data, parentId }) {
        const id = `file-${nextId++}`;
        files.set(id, { id, name, mimeType, data, parentId });
        return { id, name };
      },
      async downloadFile(fileId) {
        const file = files.get(fileId);
        return { data: file.data, mimeType: file.mimeType };
      },
      async listFiles({ parentId }) {
        return Array.from(files.values()).filter((f) => f.parentId === parentId);
      },
      async deleteFile(fileId) {
        return files.delete(fileId);
      },
    };
  }

  window.__voiceNotesConfig = {
    ui: false,
    firebase: mockFirebase({ email: 'owner@example.com', uid: 'owner-uid' }),
    allowlist: ['owner@example.com'],
    geminiClient: mockGeminiClient(),
    driveClient: mockDriveClient(),
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installMockConfig);
});

test('Scenario 1: recording a note creates two titled Drive files with matching titles', async ({ page }) => {
  await page.goto('/examples/voice-notes/index.html');
  await page.waitForFunction(() => window.__voiceNotesApp);

  await page.evaluate(async () => {
    await window.__voiceNotesApp.emulate({
      selector: '#record',
      type: 'say',
      transcript: 'Remember to buy milk and eggs from the store tomorrow morning',
    });
  });

  const files = await page.evaluate(() => Array.from(window.__mockDriveFiles.values()));

  expect(files.length).toBe(2);

  const transcriptFile = files.find((f) => f.mimeType === 'text/plain');
  const audioFile = files.find((f) => f.mimeType === 'audio/mp4');

  expect(transcriptFile).toBeTruthy();
  expect(audioFile).toBeTruthy();
  expect(transcriptFile.data.data).toBe('Remember to buy milk and eggs from the store tomorrow morning');

  // Both files are named from the same one-line summary.
  const transcriptTitle = transcriptFile.name.replace(/\.txt$/, '');
  const audioTitle = audioFile.name.replace(/\.m4a$/, '');
  expect(transcriptTitle).toBe(audioTitle);
  expect(transcriptTitle.length).toBeGreaterThan(0);
});

test('Scenario 2: two separate recordings produce two independently-titled file pairs', async ({ page }) => {
  await page.goto('/examples/voice-notes/index.html');
  await page.waitForFunction(() => window.__voiceNotesApp);

  await page.evaluate(async () => {
    await window.__voiceNotesApp.emulate({ selector: '#record', type: 'say', transcript: 'Buy milk and eggs today' });
    await window.__voiceNotesApp.emulate({ selector: '#record', type: 'say', transcript: 'Call mom about the weekend trip' });
  });

  const files = await page.evaluate(() => Array.from(window.__mockDriveFiles.values()));

  expect(files.length).toBe(4);
  const titles = new Set(files.map((f) => f.name.replace(/\.(txt|m4a)$/, '')));
  expect(titles.size).toBe(2);
});

test('Scenario 3: the command is logged and undo removes the note\'s local record', async ({ page }) => {
  await page.goto('/examples/voice-notes/index.html');
  await page.waitForFunction(() => window.__voiceNotesApp);

  await page.evaluate(async () => {
    await window.__voiceNotesApp.emulate({
      selector: '#record',
      type: 'say',
      transcript: 'Pick up the dry cleaning',
    });
  });

  const loggedEntry = await page.evaluate(() => {
    const entries = window.__voiceNotesApp.commandLog.getEntries();
    return entries[entries.length - 1];
  });
  expect(loggedEntry.transcript).toBe('Pick up the dry cleaning');
  expect(loggedEntry.detail.title.length).toBeGreaterThan(0);

  const depthBeforeUndo = await page.evaluate(() => window.__voiceNotesApp.undoStack.depth());
  expect(depthBeforeUndo).toBe(1);

  const localRecordsBeforeUndo = await page.evaluate(async () => (await window.__voiceNotesApp.db.getAll('mutations')).length);
  expect(localRecordsBeforeUndo).toBe(1);

  await page.evaluate(async () => {
    await window.__voiceNotesApp.undoStack.undo();
  });

  const localRecordsAfterUndo = await page.evaluate(async () => (await window.__voiceNotesApp.db.getAll('mutations')).length);
  expect(localRecordsAfterUndo).toBe(0);
});
