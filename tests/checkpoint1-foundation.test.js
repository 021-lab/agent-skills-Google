// Checkpoint 1: Foundation (Slices 1-2)
// Verifies dispatcher + voice + auth work together through VoiceApp.initialize():
// auth blocks unauthenticated access, and once signed in, tap/say commands
// reach the app's single handler.

import test from 'node:test';
import assert from 'node:assert';

// --- Minimal DOM/browser mocks so voiceframe.js can initialize under node:test ---
if (typeof global.document === 'undefined') {
  global.document = {
    addEventListener() {},
    body: {},
  };
}
if (typeof global.MutationObserver === 'undefined') {
  global.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
}
if (typeof global.webkitSpeechRecognition === 'undefined') {
  global.webkitSpeechRecognition = class {
    constructor() {
      this.lang = null;
      this.interimResults = false;
      this.continuous = false;
      this.onstart = null;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
    }
    start() { if (this.onstart) this.onstart(); }
    stop() { if (this.onend) this.onend(); }
  };
}
if (typeof global.window === 'undefined') {
  global.window = { webkitSpeechRecognition: global.webkitSpeechRecognition, SpeechRecognition: null };
}

const { VoiceApp } = await import('../src/voiceframe.js');

function mockFirebase(initialUser = null) {
  const listeners = [];
  let currentUser = initialUser;
  return {
    auth: {
      onAuthStateChanged(cb) {
        listeners.push(cb);
        cb(currentUser);
      },
      async signInWithCredential(credential) {
        currentUser = credential.user;
        listeners.forEach(l => l(currentUser));
        return { user: currentUser };
      },
      async signOut() {
        currentUser = null;
        listeners.forEach(l => l(null));
      },
    },
  };
}

test('Checkpoint 1: unauthenticated command is rejected before reaching app handler', async () => {
  const firebase = mockFirebase();
  const app = await VoiceApp.init({ ui: false, firebase, allowlist: ['owner@example.com'] });

  let handlerCalled = false;
  app.handle(async () => { handlerCalled = true; });

  await assert.rejects(
    () => app.handleCommand({ type: 'tap', element: {} }),
    /Authentication required/
  );
  assert.strictEqual(handlerCalled, false, 'App handler must not run without auth');
});

test('Checkpoint 1: authenticated tap command reaches the single app handler', async () => {
  const firebase = mockFirebase();
  const app = await VoiceApp.init({ ui: false, firebase, allowlist: ['owner@example.com'] });

  await app.auth.signIn({ user: { email: 'owner@example.com', uid: '123' } });

  let received = null;
  app.handle(async (ctx) => { received = ctx; });

  const mockElement = { dataset: { voice: '' } };
  await app.handleCommand({ type: 'tap', element: mockElement });

  assert.strictEqual(received.type, 'tap');
  assert.strictEqual(received.element, mockElement);
});

test('Checkpoint 1: non-allowlisted user cannot reach app handler even after signIn attempt', async () => {
  const firebase = mockFirebase();
  const app = await VoiceApp.init({ ui: false, firebase, allowlist: ['owner@example.com'] });

  await app.auth.signIn({ user: { email: 'stranger@example.com', uid: '999' } });

  let handlerCalled = false;
  app.handle(async () => { handlerCalled = true; });

  await assert.rejects(() => app.handleCommand({ type: 'tap', element: {} }));
  assert.strictEqual(handlerCalled, false);
  assert.strictEqual(app.auth.getState(), 'rejected');
});

test('Checkpoint 1: dispatcher wiring does not throw during VoiceApp initialization', async () => {
  const firebase = mockFirebase();
  await assert.doesNotReject(async () => {
    const app = await VoiceApp.init({ ui: false, firebase, allowlist: ['owner@example.com'] });
    assert.ok(app.dispatcher, 'dispatcher should be initialized');
    assert.ok(app.voiceIO, 'voiceIO should be initialized');
    assert.ok(app.auth, 'auth should be initialized when firebase+allowlist supplied');
  });
});

test('Checkpoint 1: VoiceApp works without auth config (auth optional per app)', async () => {
  const app = await VoiceApp.init({ ui: false });
  assert.strictEqual(app.auth, null, 'auth should be skipped when not configured');

  let handlerCalled = false;
  app.handle(async () => { handlerCalled = true; });

  await app.handleCommand({ type: 'tap', element: {} });
  assert.strictEqual(handlerCalled, true, 'handler should run when no auth is configured');
});
