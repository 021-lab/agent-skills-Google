// Integration: the full lifecycle in one flow — auth -> emulate -> db ->
// drive -> sync -> interpret -> log -> undo -> fixture replay. The
// checkpoint*.test.js files prove pairs of modules work together;
// this proves the whole stack behaves as one system end to end, the way a
// real app built on VoiceApp would actually use it.

import test from 'node:test';
import assert from 'node:assert';

function mockDocument(elements = {}) {
  return {
    addEventListener() {},
    body: {},
    querySelector(selector) { return elements[selector] || null; },
  };
}

if (typeof global.MutationObserver === 'undefined') {
  global.MutationObserver = class { observe() {} disconnect() {} };
}
if (typeof global.webkitSpeechRecognition === 'undefined') {
  global.webkitSpeechRecognition = class {
    constructor() { this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null; }
    start() { if (this.onstart) this.onstart(); }
    stop() { if (this.onend) this.onend(); }
  };
}
if (typeof global.window === 'undefined') {
  global.window = { webkitSpeechRecognition: global.webkitSpeechRecognition, SpeechRecognition: null };
}

const { VoiceApp } = await import('../src/voiceframe.js');

function createMockIDB() {
  const stores = { mutations: new Map(), metadata: new Map(), outbox: new Map(), log: new Map(), fixtures: new Map() };
  function makeRequest(work) {
    const request = {};
    queueMicrotask(() => {
      try { request.result = work(); if (request.onsuccess) request.onsuccess(); }
      catch (err) { request.error = err; if (request.onerror) request.onerror(); }
    });
    return request;
  }
  function makeStore(map) {
    return {
      put(record) { return makeRequest(() => { map.set(record.id, record); return record; }); },
      get(id) { return makeRequest(() => map.get(id)); },
      getAll() { return makeRequest(() => Array.from(map.values())); },
      delete(id) { return makeRequest(() => { map.delete(id); return true; }); },
      clear() { return makeRequest(() => map.clear()); },
    };
  }
  const db = {
    objectStoreNames: { contains: (name) => name in stores },
    createObjectStore(name) { stores[name] = stores[name] || new Map(); return makeStore(stores[name]); },
    transaction(name) { return { objectStore: () => makeStore(stores[name]) }; },
    close() {},
  };
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        if (request.onupgradeneeded) request.onupgradeneeded({ target: { result: db } });
        request.result = db;
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
  };
}

function createMockFirebase(user) {
  const listeners = [];
  return {
    auth: {
      onAuthStateChanged(cb) { listeners.push(cb); cb(user); },
      async signInWithCredential(credential) { listeners.forEach((l) => l(credential.user)); return { user: credential.user }; },
      async signOut() { listeners.forEach((l) => l(null)); },
    },
  };
}

function createMockFirestore() {
  const docs = new Map();
  return {
    docs,
    collection() {
      return {
        doc(id) {
          return {
            async set(data) { docs.set(id, data); },
            async get() { return { id, data: () => docs.get(id) }; },
          };
        },
        onSnapshot(cb) {
          cb({ docs: Array.from(docs.entries()).map(([docId, data]) => ({ id: docId, data: () => data })) });
          return () => {};
        },
      };
    },
  };
}

function createMockDriveClient() {
  const folders = new Map();
  const files = new Map();
  let nextId = 1;
  return {
    files,
    async findFolder({ name, parentId }) { return folders.get(`${parentId ?? 'root'}/${name}`) || null; },
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
    async listFiles({ parentId }) { return Array.from(files.values()).filter((f) => f.parentId === parentId); },
    async deleteFile(fileId) { return files.delete(fileId); },
  };
}

function createMockGeminiClient() {
  const calls = [];
  return {
    calls,
    async generate({ prompt }) {
      calls.push(prompt);
      if (prompt.includes('Extract structured intent')) {
        return { text: '{"action":"add","item":"milk"}' };
      }
      return { text: 'Buy milk' }; // summarize()
    },
  };
}

test('Integration: full lifecycle — auth gate, emulate, db+drive+sync, interpret, log, undo, fixture replay', async () => {
  const recordButton = { id: 'record' };
  global.document = mockDocument({ '#record': recordButton });

  const firebase = createMockFirebase({ email: 'owner@example.com', uid: 'owner-uid' });
  const firestore = createMockFirestore();
  const driveClient = createMockDriveClient();
  const geminiClient = createMockGeminiClient();

  const app = await VoiceApp.init({
    ui: false,
    idb: createMockIDB(),
    firebase,
    allowlist: ['owner@example.com'],
    firestore,
    driveClient,
    geminiClient,
    appId: 'integration-app',
  });

  // 1. Auth gate: before this point nothing else in the stack should be
  // reachable through the command path.
  assert.strictEqual(app.auth.isSignedIn(), true, 'mock user is pre-authenticated');

  let handlerRuns = 0;
  app.handle(async (ctx) => {
    handlerRuns += 1;

    const intent = await ctx.interpret(ctx.transcript, {
      type: 'object',
      properties: { action: { type: 'string' }, item: { type: 'string' } },
      required: ['action', 'item'],
    });

    await ctx.db.put('mutations', { id: intent.item, action: intent.action });

    const title = await app.summarize(ctx.transcript);
    await ctx.drive.upload({ name: `${title}.txt`, blob: { data: ctx.transcript }, mimeType: 'text/plain' });

    await app.sync.push({ id: intent.item, action: intent.action });

    ctx.log({ intent, title });
  });

  // 2. Dispatch through the agent-emulation path — same handler as live input.
  const result = await app.emulate({ selector: '#record', type: 'say', transcript: 'add milk to the list' });
  assert.strictEqual(result.success, true);
  assert.strictEqual(handlerRuns, 1);

  // 3. ctx.db mutation landed locally.
  const localRecord = await app.db.get('mutations', 'milk');
  assert.strictEqual(localRecord.action, 'add');

  // 4. ctx.drive upload landed in the mock Drive client, scoped under this app's folder.
  const uploadedFile = Array.from(driveClient.files.values())[0];
  assert.strictEqual(uploadedFile.name, 'Buy milk.txt');
  assert.strictEqual(uploadedFile.data.data, 'add milk to the list');

  // 5. sync.push mirrored the mutation to Firestore.
  assert.ok(firestore.docs.has('milk'), 'mutation should have synced to Firestore');
  assert.strictEqual(firestore.docs.get('milk').action, 'add');

  // 6. The command was logged with the structured detail attached via ctx.log().
  const entries = app.commandLog.getEntries();
  assert.strictEqual(entries.length, 1);
  assert.deepStrictEqual(entries[0].detail.intent, { action: 'add', item: 'milk' });

  // 7. Undo reverses the ctx.db mutation (Drive/Firestore writes are out of
  // scope for the undo stack in this version — see SPEC.md's soft
  // containment model; only ctx.db is auto-tracked).
  assert.strictEqual(app.undoStack.depth(), 1);
  await app.undoStack.undo();
  assert.strictEqual(await app.db.get('mutations', 'milk'), undefined);

  // 8. Voice-correct the logged command into a fixture, and replay it via
  // emulate() against a fixed handler — the "Agent replay" acceptance
  // criterion, exercised across the entire stack this time.
  const fixture = await app.commandLog.correct(entries[0].id, {
    transcript: 'add milk to the list',
    expected: { item: 'milk', action: 'add' },
  });
  const persisted = JSON.parse(JSON.stringify(fixture));

  const replay = await app.emulate({
    selector: persisted.selector,
    type: persisted.type,
    transcript: persisted.transcript,
  });
  assert.strictEqual(replay.success, true);
  assert.strictEqual(handlerRuns, 2, 'replay should re-run the same handler');

  const replayedRecord = await app.db.get('mutations', 'milk');
  assert.strictEqual(replayedRecord.action, 'add', 'replay reproduces the original mutation');

  // 9. Signing out should block further commands from reaching the handler.
  await app.auth.signOut();
  await assert.rejects(() => app.emulate({ selector: '#record', type: 'say', transcript: 'add eggs' }));
  assert.strictEqual(handlerRuns, 2, 'handler must not run once signed out');
});

test('Integration: non-allowlisted user is blocked from the entire stack, not just auth', async () => {
  const recordButton = { id: 'record' };
  global.document = mockDocument({ '#record': recordButton });

  const firebase = createMockFirebase({ email: 'stranger@example.com', uid: 'stranger-uid' });
  const driveClient = createMockDriveClient();

  const app = await VoiceApp.init({
    ui: false,
    idb: createMockIDB(),
    firebase,
    allowlist: ['owner@example.com'],
    driveClient,
    appId: 'integration-app',
  });

  assert.strictEqual(app.auth.isSignedIn(), false);
  assert.strictEqual(app.drive, null, 'per-user Drive should never wire up for a rejected user');

  let handlerRuns = 0;
  app.handle(async () => { handlerRuns += 1; });

  await assert.rejects(() => app.emulate({ selector: '#record', type: 'say', transcript: 'add milk' }));
  assert.strictEqual(handlerRuns, 0);
  assert.strictEqual(driveClient.files.size, 0, 'no Drive I/O should have occurred');
});
