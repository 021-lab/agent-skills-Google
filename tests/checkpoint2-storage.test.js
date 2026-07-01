// Checkpoint 2: Storage & State Management (Slices 3-4)
// Verifies db + sync + drive + undo + log work together through VoiceApp:
// mutations made via ctx.db sync to Firestore, undo reverses them LIFO,
// and every command is logged with fixtures round-tripping through JSON.

import test from 'node:test';
import assert from 'node:assert';

if (typeof global.document === 'undefined') {
  global.document = { addEventListener() {}, body: {}, querySelector() { return null; } };
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
      async signInWithCredential(credential) { listeners.forEach(l => l(credential.user)); return { user: credential.user }; },
      async signOut() { listeners.forEach(l => l(null)); },
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
          cb({ docs: Array.from(docs.entries()).map(([id, data]) => ({ id, data: () => data })) });
          return () => {};
        },
      };
    },
  };
}

test('Checkpoint 2: local mutation via ctx.db syncs to Firestore', async () => {
  const firebase = createMockFirebase({ email: 'owner@example.com', uid: 'u1' });
  const firestore = createMockFirestore();
  const app = await VoiceApp.init({
    ui: false,
    idb: createMockIDB(),
    firebase,
    allowlist: ['owner@example.com'],
    firestore,
  });

  let capturedCtx = null;
  app.handle(async (ctx) => {
    capturedCtx = ctx;
    const saved = await ctx.db.put('mutations', { id: 'item-1', text: 'buy milk' });
    // Mirror the write to Firestore the way an app would via sync.push in a
    // real integration; here we drive sync directly to prove the pipeline.
    await app.sync.push(saved);
  });

  await app.handleCommand({ type: 'tap', element: { id: 'add-btn' } });

  assert.ok(firestore.docs.has('item-1'), 'mutation should reach Firestore');
  assert.strictEqual(firestore.docs.get('item-1').text, 'buy milk');
  assert.ok(capturedCtx.db, 'ctx.db should be provided to the handler');
});

test('Checkpoint 2: Firestore changes reconcile into local storage via sync', async () => {
  const firebase = createMockFirebase({ email: 'owner@example.com', uid: 'u1' });
  const firestore = createMockFirestore();
  await firestore.collection('x').doc('item-2').set({ id: 'item-2', text: 'seeded remotely', _ts: 100 });

  const app = await VoiceApp.init({
    ui: false,
    idb: createMockIDB(),
    firebase,
    allowlist: ['owner@example.com'],
    firestore,
  });

  // sync.start() runs during _wireUserData(); allow its microtasks to settle.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const local = await app.db.get('mutations', 'item-2');
  assert.ok(local, 'remote record should have synced into local db');
  assert.strictEqual(local.text, 'seeded remotely');
});

test('Checkpoint 2: undo reverses a ctx.db mutation made by the app handler', async () => {
  const firebase = createMockFirebase({ email: 'owner@example.com', uid: 'u1' });
  const app = await VoiceApp.init({
    ui: false,
    idb: createMockIDB(),
    firebase,
    allowlist: ['owner@example.com'],
  });

  app.handle(async (ctx) => {
    await ctx.db.put('mutations', { id: 'item-3', text: 'v1' });
  });

  await app.handleCommand({ type: 'tap', element: { id: 'add-btn' } });

  assert.ok(await app.db.get('mutations', 'item-3'), 'mutation should exist before undo');
  assert.strictEqual(app.undoStack.depth(), 1);

  await app.undoStack.undo();

  assert.strictEqual(await app.db.get('mutations', 'item-3'), undefined, 'undo should remove the inserted record');
});

test('Checkpoint 2: N undo operations reverse N commands in LIFO order', async () => {
  const firebase = createMockFirebase({ email: 'owner@example.com', uid: 'u1' });
  const app = await VoiceApp.init({
    ui: false,
    idb: createMockIDB(),
    firebase,
    allowlist: ['owner@example.com'],
  });

  app.handle(async (ctx) => {
    await ctx.db.put('mutations', { id: ctx.transcript, text: ctx.transcript });
  });

  await app.handleCommand({ type: 'tap', element: { id: 'a' }, transcript: 'first' });
  await app.handleCommand({ type: 'tap', element: { id: 'b' }, transcript: 'second' });
  await app.handleCommand({ type: 'tap', element: { id: 'c' }, transcript: 'third' });

  assert.strictEqual(app.undoStack.depth(), 3);

  await app.undoStack.undoN(3);

  assert.strictEqual(await app.db.get('mutations', 'first'), undefined);
  assert.strictEqual(await app.db.get('mutations', 'second'), undefined);
  assert.strictEqual(await app.db.get('mutations', 'third'), undefined);
  assert.strictEqual(app.undoStack.depth(), 0);
});

test('Checkpoint 2: every command is logged, and a voice correction round-trips as a fixture', async () => {
  const firebase = createMockFirebase({ email: 'owner@example.com', uid: 'u1' });
  const app = await VoiceApp.init({
    ui: false,
    idb: createMockIDB(),
    firebase,
    allowlist: ['owner@example.com'],
  });

  app.handle(async (ctx) => {
    ctx.log({ handled: true });
  });

  await app.handleCommand({ type: 'say', element: { id: 'record' }, transcript: 'mark this done' });

  const entries = app.commandLog.getEntries();
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].transcript, 'mark this done');
  assert.deepStrictEqual(entries[0].detail, { handled: true }, 'ctx.log(detail) should attach to the entry');

  const fixture = await app.commandLog.correct(entries[0].id, {
    transcript: 'mark this as done',
    expected: { done: true },
  });

  const roundTripped = JSON.parse(JSON.stringify(fixture));
  assert.deepStrictEqual(roundTripped, fixture);
  assert.strictEqual(roundTripped.transcript, 'mark this as done');
});
