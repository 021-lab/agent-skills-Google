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
    textContent: '',
    addEventListener(event, handler) { listeners[event] = handler; },
    click() { if (listeners.click) listeners.click(); },
  };
}

// Minimal mock matching the Auth class's public surface used by ui.js.
function createMockAuth(initialUser = null) {
  const listeners = [];
  let user = initialUser;
  let popupResult = null;
  let popupError = null;

  return {
    isSignedIn() { return user !== null; },
    getUser() { return user; },
    onChange(cb) { listeners.push(cb); return () => {}; },
    async signOut() {
      user = null;
      listeners.forEach((l) => l({ state: 'signed-out', user: null }));
    },
    async signInWithGooglePopup() {
      if (popupError) throw popupError;
      user = popupResult;
      listeners.forEach((l) => l({ state: 'signed-in', user }));
      return user;
    },
    _setPopupResult(u) { popupResult = u; },
    _setPopupError(e) { popupError = e; },
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

test('UI: no sign-in button wiring when auth is not configured', () => {
  const { ui, elements } = createBoundUI(); // no auth passed
  assert.strictEqual(ui.auth, null);
  // updateAuthState() should be a no-op without throwing.
  assert.doesNotThrow(() => ui.updateAuthState());
});

test('UI: sign-in button reflects signed-out state initially', () => {
  const auth = createMockAuth();
  const ui = new UI({ undoStack: new UndoStack(), commandLog: new CommandLog(), auth });
  const elements = {
    undoBtn: createMockElement(),
    logTab: createMockElement(),
    micIndicator: createMockElement(),
    logPanel: createMockElement(),
    signInBtn: createMockElement(),
    authStatus: createMockElement(),
    authError: createMockElement(),
  };
  ui.bindElements(elements);

  assert.strictEqual(elements.signInBtn.textContent, 'Sign in');
  assert.strictEqual(elements.authStatus.textContent, '');
});

test('UI: sign-in button reflects already-signed-in state on bind', () => {
  const auth = createMockAuth({ email: 'owner@example.com', uid: 'u1' });
  const ui = new UI({ undoStack: new UndoStack(), commandLog: new CommandLog(), auth });
  const elements = {
    undoBtn: createMockElement(),
    logTab: createMockElement(),
    micIndicator: createMockElement(),
    logPanel: createMockElement(),
    signInBtn: createMockElement(),
    authStatus: createMockElement(),
    authError: createMockElement(),
  };
  ui.bindElements(elements);

  assert.strictEqual(elements.signInBtn.textContent, 'Sign out');
  assert.strictEqual(elements.authStatus.textContent, 'owner@example.com');
});

test('UI: clicking sign-in triggers signInWithGooglePopup and updates the button to Sign out', async () => {
  const auth = createMockAuth();
  auth._setPopupResult({ email: 'owner@example.com', uid: 'u1' });
  const ui = new UI({ undoStack: new UndoStack(), commandLog: new CommandLog(), auth });
  const elements = {
    undoBtn: createMockElement(),
    logTab: createMockElement(),
    micIndicator: createMockElement(),
    logPanel: createMockElement(),
    signInBtn: createMockElement(),
    authStatus: createMockElement(),
    authError: createMockElement(),
  };
  ui.bindElements(elements);

  elements.signInBtn.click();
  await new Promise((r) => setTimeout(r, 0));

  assert.strictEqual(elements.signInBtn.textContent, 'Sign out');
  assert.strictEqual(elements.authStatus.textContent, 'owner@example.com');
});

test('UI: clicking sign-out when already signed in calls signOut', async () => {
  const auth = createMockAuth({ email: 'owner@example.com', uid: 'u1' });
  const ui = new UI({ undoStack: new UndoStack(), commandLog: new CommandLog(), auth });
  const elements = {
    undoBtn: createMockElement(),
    logTab: createMockElement(),
    micIndicator: createMockElement(),
    logPanel: createMockElement(),
    signInBtn: createMockElement(),
    authStatus: createMockElement(),
    authError: createMockElement(),
  };
  ui.bindElements(elements);
  assert.strictEqual(elements.signInBtn.textContent, 'Sign out');

  elements.signInBtn.click();
  await new Promise((r) => setTimeout(r, 0));

  assert.strictEqual(auth.isSignedIn(), false);
  assert.strictEqual(elements.signInBtn.textContent, 'Sign in');
});

test('UI: a failed sign-in popup is logged, not thrown, and leaves the button in signed-out state', async () => {
  const auth = createMockAuth();
  auth._setPopupError(new Error('popup closed by user'));
  const ui = new UI({ undoStack: new UndoStack(), commandLog: new CommandLog(), auth });
  const elements = {
    undoBtn: createMockElement(),
    logTab: createMockElement(),
    micIndicator: createMockElement(),
    logPanel: createMockElement(),
    signInBtn: createMockElement(),
    authStatus: createMockElement(),
    authError: createMockElement(),
  };
  ui.bindElements(elements);

  const originalError = console.error;
  let loggedError = null;
  console.error = (...args) => { loggedError = args; };
  try {
    elements.signInBtn.click();
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.error = originalError;
  }

  assert.ok(loggedError, 'error should be logged, not thrown to an unhandled rejection');
  assert.strictEqual(elements.signInBtn.textContent, 'Sign in');
  assert.strictEqual(elements.authError.hidden, false, 'error message should become visible');
  assert.strictEqual(elements.authError.textContent, 'popup closed by user');
});

test('UI: a Google-blocked sign-in (e.g. not on the Test users list) shows a visible error', async () => {
  const auth = createMockAuth();
  auth._setPopupError(new Error('Access blocked: this app has not completed Google verification'));
  const ui = new UI({ undoStack: new UndoStack(), commandLog: new CommandLog(), auth });
  const elements = {
    undoBtn: createMockElement(),
    logTab: createMockElement(),
    micIndicator: createMockElement(),
    logPanel: createMockElement(),
    signInBtn: createMockElement(),
    authStatus: createMockElement(),
    authError: createMockElement(),
  };
  ui.bindElements(elements);

  const originalError = console.error;
  console.error = () => {};
  try {
    elements.signInBtn.click();
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.error = originalError;
  }

  assert.strictEqual(elements.authError.hidden, false);
  assert.match(elements.authError.textContent, /Access blocked/);
});

test('UI: a successful sign-in clears any previously shown error', async () => {
  const auth = createMockAuth();
  auth._setPopupError(new Error('temporary failure'));
  const ui = new UI({ undoStack: new UndoStack(), commandLog: new CommandLog(), auth });
  const elements = {
    undoBtn: createMockElement(),
    logTab: createMockElement(),
    micIndicator: createMockElement(),
    logPanel: createMockElement(),
    signInBtn: createMockElement(),
    authStatus: createMockElement(),
    authError: createMockElement(),
  };
  ui.bindElements(elements);

  const originalError = console.error;
  console.error = () => {};
  try {
    elements.signInBtn.click(); // fails, shows error
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(elements.authError.hidden, false);

    auth._setPopupError(null);
    auth._setPopupResult({ email: 'owner@example.com', uid: 'u1' });
    elements.signInBtn.click(); // succeeds this time
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.error = originalError;
  }

  assert.strictEqual(elements.authError.hidden, true, 'error should clear on successful sign-in');
  assert.strictEqual(elements.authError.textContent, '');
});

test('UI: starting a new sign-in attempt clears the previous error before retrying', async () => {
  const auth = createMockAuth();
  auth._setPopupError(new Error('first failure'));
  const ui = new UI({ undoStack: new UndoStack(), commandLog: new CommandLog(), auth });
  const elements = {
    undoBtn: createMockElement(),
    logTab: createMockElement(),
    micIndicator: createMockElement(),
    logPanel: createMockElement(),
    signInBtn: createMockElement(),
    authStatus: createMockElement(),
    authError: createMockElement(),
  };
  ui.bindElements(elements);

  const originalError = console.error;
  console.error = () => {};
  try {
    elements.signInBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(elements.authError.textContent, 'first failure');

    auth._setPopupError(new Error('second failure'));
    elements.signInBtn.click();
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    console.error = originalError;
  }

  assert.strictEqual(elements.authError.textContent, 'second failure', 'stale error text should not linger');
});

test('UI: auth.onChange notifications keep the button in sync with external state changes', async () => {
  const auth = createMockAuth();
  const ui = new UI({ undoStack: new UndoStack(), commandLog: new CommandLog(), auth });
  const elements = {
    undoBtn: createMockElement(),
    logTab: createMockElement(),
    micIndicator: createMockElement(),
    logPanel: createMockElement(),
    signInBtn: createMockElement(),
    authStatus: createMockElement(),
    authError: createMockElement(),
  };
  ui.bindElements(elements);

  // Simulate a session restore firing onChange independently of the button click.
  auth._setPopupResult({ email: 'owner@example.com', uid: 'u1' });
  await auth.signInWithGooglePopup();

  assert.strictEqual(elements.signInBtn.textContent, 'Sign out');
});
