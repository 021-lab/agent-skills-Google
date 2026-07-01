import test from 'node:test';
import assert from 'node:assert';
import { UI } from '../src/core/ui.js';
import { UndoStack } from '../src/core/undo.js';
import { CommandLog } from '../src/core/log.js';

// Lightweight mock DOM element: tracks property assignments and click handlers.
function createMockElement() {
  const listeners = {};
  return {
    disabled: false,
    hidden: true, // log-panel starts hidden in the real markup (<div hidden>)
    className: '',
    innerHTML: '',
    addEventListener(event, handler) { listeners[event] = handler; },
    click() { if (listeners.click) listeners.click(); },
  };
}

function createBoundUI(overrides = {}) {
  const undoStack = overrides.undoStack ?? new UndoStack();
  const commandLog = overrides.commandLog ?? new CommandLog();
  const ui = new UI({ undoStack, commandLog });

  const elements = {
    undoBtn: createMockElement(),
    logTab: createMockElement(),
    micIndicator: createMockElement(),
    logPanel: createMockElement(),
  };
  ui.bindElements(elements);

  return { ui, elements, undoStack, commandLog };
}

test('UI: mount() requires a browser document', () => {
  const ui = new UI({});
  assert.throws(() => ui.mount(), /requires a browser document/);
});

test('UI: bindElements wires click handlers for undo and log tab', () => {
  const { elements } = createBoundUI();
  // addEventListener should have registered a click handler (click() works below)
  assert.doesNotThrow(() => elements.undoBtn.click());
  assert.doesNotThrow(() => elements.logTab.click());
});

test('UI: undo button starts disabled when the stack is empty', () => {
  const { elements } = createBoundUI();
  assert.strictEqual(elements.undoBtn.disabled, true);
});

test('UI: undo button becomes enabled once a mutation is pushed', () => {
  const { ui, elements, undoStack } = createBoundUI();
  undoStack.push({ mutation: {}, inverse: () => {} });
  ui.updateUndoState();
  assert.strictEqual(elements.undoBtn.disabled, false);
});

test('UI: clicking Undo applies the inverse and re-disables when the stack empties', async () => {
  const { elements, undoStack, ui } = createBoundUI();
  let applied = false;
  undoStack.push({ mutation: {}, inverse: () => { applied = true; } });
  ui.updateUndoState();
  assert.strictEqual(elements.undoBtn.disabled, false);

  elements.undoBtn.click();
  // handleUndoClick is async; flush microtasks
  await new Promise((r) => setTimeout(r, 0));

  assert.strictEqual(applied, true);
  assert.strictEqual(elements.undoBtn.disabled, true, 'button should re-disable once stack is empty');
});

test('UI: clicking Undo on an empty stack is a no-op', async () => {
  const { elements } = createBoundUI();
  assert.doesNotThrow(() => elements.undoBtn.click());
  await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(elements.undoBtn.disabled, true);
});

test('UI: log tab toggles panel visibility', () => {
  const { ui, elements } = createBoundUI();
  assert.strictEqual(elements.logPanel.hidden, true);

  elements.logTab.click();
  assert.strictEqual(elements.logPanel.hidden, false);
  assert.strictEqual(ui.logPanelOpen, true);

  elements.logTab.click();
  assert.strictEqual(elements.logPanel.hidden, true);
  assert.strictEqual(ui.logPanelOpen, false);
});

test('UI: renderLog produces a view-model for each command log entry', async () => {
  const { ui, commandLog } = createBoundUI();
  await commandLog.record({ type: 'tap', selector: '#a' });
  await commandLog.record({ type: 'say', transcript: 'buy milk' });

  const rows = ui.renderLog();

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].label, 'tap');
  assert.strictEqual(rows[1].label, 'say: buy milk');
});

test('UI: opening the log tab renders current entries into the panel', async () => {
  const { ui, elements, commandLog } = createBoundUI();
  await commandLog.record({ type: 'say', transcript: 'call mom' });

  elements.logTab.click();

  assert.match(elements.logPanel.innerHTML, /call mom/);
});

test('UI: setMicState updates the mic indicator className', () => {
  const { ui, elements } = createBoundUI();
  assert.strictEqual(elements.micIndicator.className, 'idle');

  ui.setMicState('listening');
  assert.strictEqual(elements.micIndicator.className, 'listening');

  ui.setMicState('recording');
  assert.strictEqual(elements.micIndicator.className, 'recording');
});

test('UI: setMicState rejects unknown states', () => {
  const { ui } = createBoundUI();
  assert.throws(() => ui.setMicState('bogus'), /Unknown mic state: bogus/);
});

test('UI: works without a commandLog (renderLog returns empty)', () => {
  const ui = new UI({ undoStack: new UndoStack() });
  ui.bindElements({ undoBtn: createMockElement(), logTab: createMockElement(), micIndicator: createMockElement(), logPanel: createMockElement() });

  const rows = ui.renderLog();
  assert.deepStrictEqual(rows, []);
});

test('UI: undo re-render updates log panel when open', async () => {
  const { ui, elements, undoStack, commandLog } = createBoundUI();
  const entry = await commandLog.record({ type: 'tap', selector: '#a' });
  undoStack.push({ mutation: {}, inverse: () => {} });
  ui.updateUndoState();

  elements.logTab.click(); // open panel, renders once
  assert.match(elements.logPanel.innerHTML, /tap/);

  elements.undoBtn.click();
  await new Promise((r) => setTimeout(r, 0));

  // Panel should still reflect the (unchanged) log entries after undo re-render
  assert.match(elements.logPanel.innerHTML, /tap/);
});
