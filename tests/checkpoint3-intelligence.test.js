// Checkpoint 3: Intelligence & Testing (Slices 5-6)
// Verifies Gemini (ai.js) and the emulation API (emulate.js) work together
// through VoiceApp: emulated "say" commands can call ctx.interpret() against
// a real (mocked) Gemini client, and a corrected fixture can be replayed via
// emulate() to reproduce and verify a fix — the "Agent replay" acceptance
// criterion from SPEC.md.

import test from 'node:test';
import assert from 'node:assert';

function createMockElement(id) {
  return { id };
}

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

function createMockGeminiClient(responseText) {
  const calls = [];
  return {
    calls,
    async generate({ model, prompt }) {
      calls.push({ model, prompt });
      return { text: typeof responseText === 'function' ? responseText(prompt) : responseText };
    },
  };
}

test('Checkpoint 3: emulate() drives a "say" command whose handler calls ctx.interpret() via Gemini', async () => {
  const recordButton = createMockElement('record');
  global.document = mockDocument({ '#record': recordButton });

  const geminiClient = createMockGeminiClient('{"action":"add","item":"milk"}');
  const app = await VoiceApp.init({ ui: false, geminiClient });

  let interpreted = null;
  app.handle(async (ctx) => {
    interpreted = await ctx.interpret(ctx.transcript, {
      type: 'object',
      properties: { action: { type: 'string' }, item: { type: 'string' } },
      required: ['action', 'item'],
    });
  });

  const result = await app.emulate({ selector: '#record', type: 'say', transcript: 'add milk to the list' });

  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(interpreted, { action: 'add', item: 'milk' });
  assert.match(geminiClient.calls[0].prompt, /add milk to the list/);
});

test('Checkpoint 3: app.summarize() produces a one-line title from a handler driven by emulate()', async () => {
  const recordButton = createMockElement('record');
  global.document = mockDocument({ '#record': recordButton });

  const geminiClient = createMockGeminiClient('Buy milk and eggs');
  const app = await VoiceApp.init({ ui: false, geminiClient });

  let title = null;
  app.handle(async (ctx) => {
    title = await app.summarize(ctx.transcript);
  });

  await app.emulate({
    selector: '#record',
    type: 'say',
    transcript: 'Remember to buy milk and eggs from the store tomorrow',
  });

  assert.strictEqual(title, 'Buy milk and eggs');
});

test('Checkpoint 3: a mis-handled command, once corrected into a fixture, replays via emulate() to prove a fix', async () => {
  const recordButton = createMockElement('record');
  global.document = mockDocument({ '#record': recordButton });

  const app = await VoiceApp.init({ ui: false });

  // Buggy handler: misinterprets "mark this done" and never marks anything done.
  let itemDone = false;
  app.handle(async (ctx) => {
    if (ctx.transcript === 'mark this done') {
      // bug: handler only reacts to a different exact phrase
    }
  });

  await app.emulate({ selector: '#record', type: 'say', transcript: 'mark this done' });
  assert.strictEqual(itemDone, false, 'reproduces the bug: command was mis-handled');

  // User voice-corrects the logged command in the log tab.
  const entries = app.commandLog.getEntries();
  const lastEntry = entries[entries.length - 1];
  const fixture = await app.commandLog.correct(lastEntry.id, {
    transcript: 'mark this done',
    expected: { itemDone: true },
  });

  // Fixture round-trips through JSON exactly as it would when persisted to
  // issues/NNNN-*.fixture.json and read back by the agent.
  const persisted = JSON.parse(JSON.stringify(fixture));
  assert.strictEqual(persisted.selector, '#record');
  assert.strictEqual(persisted.type, 'say');

  // Agent fixes the app handler.
  app.handle(async (ctx) => {
    if (ctx.transcript === 'mark this done') {
      itemDone = true;
    }
  });

  // Agent replays the fixture via the emulation API against the (now fixed) app.
  const replay = await app.emulate({
    selector: persisted.selector,
    type: persisted.type,
    transcript: persisted.transcript,
  });

  assert.strictEqual(replay.success, true);
  assert.strictEqual(itemDone, true, 'fixture replay proves the fix');
});

test('Checkpoint 3: emulated commands are logged identically to how live dispatch logs them', async () => {
  const recordButton = createMockElement('record');
  global.document = mockDocument({ '#record': recordButton });

  const app = await VoiceApp.init({ ui: false });
  app.handle(async () => {});

  await app.emulate({ selector: '#record', type: 'say', transcript: 'call mom' });

  const entries = app.commandLog.getEntries();
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].selector, '#record');
  assert.strictEqual(entries[0].type, 'say');
  assert.strictEqual(entries[0].transcript, 'call mom');
});
