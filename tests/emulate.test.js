import test from 'node:test';
import assert from 'node:assert';
import { Emulator } from '../src/core/emulate.js';

function mockDocument(elements = {}) {
  return {
    querySelector(selector) { return elements[selector] || null; },
  };
}

test('Emulator: requires a dispatchCommand function', () => {
  assert.throws(() => new Emulator({}), /requires a dispatchCommand function/);
});

test('Emulator.run: requires a selector', async () => {
  global.document = mockDocument();
  const emulator = new Emulator({ dispatchCommand: async () => {} });
  await assert.rejects(() => emulator.run({}), /requires selector/);
});

test('Emulator.run: throws when the element is not found', async () => {
  global.document = mockDocument();
  const emulator = new Emulator({ dispatchCommand: async () => {} });
  await assert.rejects(() => emulator.run({ selector: '#missing' }), /Element not found: #missing/);
});

test('Emulator.run: dispatches through the same code path as user input', async () => {
  const element = { id: 'record' };
  global.document = mockDocument({ '#record': element });

  let dispatchedCtx = null;
  const emulator = new Emulator({
    dispatchCommand: async (ctx) => { dispatchedCtx = ctx; },
  });

  const result = await emulator.run({ selector: '#record', type: 'say', transcript: 'mark this done' });

  assert.strictEqual(dispatchedCtx.element, element);
  assert.strictEqual(dispatchedCtx.type, 'say');
  assert.strictEqual(dispatchedCtx.transcript, 'mark this done');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.context, dispatchedCtx);
});

test('Emulator.run: defaults type to "say" when omitted', async () => {
  global.document = mockDocument({ '#record': {} });
  let dispatchedCtx = null;
  const emulator = new Emulator({ dispatchCommand: async (ctx) => { dispatchedCtx = ctx; } });

  await emulator.run({ selector: '#record' });

  assert.strictEqual(dispatchedCtx.type, 'say');
});

test('Emulator.run: calls requireAuth before dispatching', async () => {
  global.document = mockDocument({ '#record': {} });
  let authChecked = false;
  let dispatched = false;

  const emulator = new Emulator({
    dispatchCommand: async () => { dispatched = true; },
    requireAuth: () => { authChecked = true; },
  });

  await emulator.run({ selector: '#record', type: 'tap' });

  assert.strictEqual(authChecked, true);
  assert.strictEqual(dispatched, true);
});

test('Emulator.run: propagates requireAuth rejection without dispatching', async () => {
  global.document = mockDocument({ '#record': {} });
  let dispatched = false;

  const emulator = new Emulator({
    dispatchCommand: async () => { dispatched = true; },
    requireAuth: () => { throw new Error('Authentication required before data access'); },
  });

  await assert.rejects(() => emulator.run({ selector: '#record', type: 'tap' }), /Authentication required/);
  assert.strictEqual(dispatched, false);
});

test('Emulator.run: passes through audioBlob when provided', async () => {
  global.document = mockDocument({ '#record': {} });
  let dispatchedCtx = null;
  const emulator = new Emulator({ dispatchCommand: async (ctx) => { dispatchedCtx = ctx; } });

  const fakeBlob = { size: 1024, type: 'audio/mp4' };
  await emulator.run({ selector: '#record', type: 'say', audioBlob: fakeBlob });

  assert.strictEqual(dispatchedCtx.audioBlob, fakeBlob);
});

test('Emulator.exposeOnWindow: installs emulate on window.__voiceframe', async () => {
  global.document = mockDocument({ '#record': {} });
  let dispatchedCtx = null;
  const emulator = new Emulator({ dispatchCommand: async (ctx) => { dispatchedCtx = ctx; } });

  const fakeWindow = {};
  emulator.exposeOnWindow(fakeWindow);

  assert.strictEqual(typeof fakeWindow.__voiceframe.emulate, 'function');

  await fakeWindow.__voiceframe.emulate({ selector: '#record', type: 'tap' });
  assert.strictEqual(dispatchedCtx.type, 'tap');
});

test('Emulator.exposeOnWindow: preserves existing window.__voiceframe properties', () => {
  const emulator = new Emulator({ dispatchCommand: async () => {} });
  const fakeWindow = { __voiceframe: { existing: true } };

  emulator.exposeOnWindow(fakeWindow);

  assert.strictEqual(fakeWindow.__voiceframe.existing, true);
  assert.strictEqual(typeof fakeWindow.__voiceframe.emulate, 'function');
});
