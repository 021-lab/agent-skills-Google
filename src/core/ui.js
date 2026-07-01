// ui.js: injected chrome — Undo button, Log tab, mic/recording indicator.
// DOM creation (mount) is isolated from the state/render logic below it so
// the logic is unit-testable without a real DOM; mount() is exercised by a
// Playwright E2E test against a real page instead.

const MIC_STATES = ['idle', 'listening', 'recording'];

export class UI {
  constructor({ undoStack, commandLog, voiceIO, auth } = {}) {
    this.undoStack = undoStack;
    this.commandLog = commandLog;
    this.voiceIO = voiceIO;
    this.auth = auth ?? null;
    this.elements = { undoBtn: null, logTab: null, micIndicator: null, logPanel: null, signInBtn: null };
    this.logPanelOpen = false;
    this.host = null;
  }

  // Binds this UI to already-created DOM-like elements. Used by mount() for
  // real DOM, and directly by unit tests with lightweight element mocks.
  // signInBtn is optional — only present/wired when an auth provider that
  // supports it is configured; existing callers that don't pass it (or
  // don't configure auth at all) are unaffected.
  bindElements(elements) {
    this.elements = elements;

    if (this.elements.undoBtn) {
      this.elements.undoBtn.addEventListener('click', () => this.handleUndoClick());
    }
    if (this.elements.logTab) {
      this.elements.logTab.addEventListener('click', () => this.toggleLogPanel());
    }
    if (this.elements.signInBtn) {
      this.elements.signInBtn.addEventListener('click', () => this.handleSignInClick());
      if (this.auth) {
        this.auth.onChange(() => this.updateAuthState());
      }
      this.updateAuthState();
    }

    this.updateUndoState();
    this.setMicState('idle');
  }

  mount(target) {
    if (typeof document === 'undefined') {
      throw new Error('mount() requires a browser document');
    }

    const host = document.createElement('div');
    host.id = 'voiceframe-ui';
    const shadow = host.attachShadow({ mode: 'open' });

    // The sign-in button/status only renders when an auth provider is
    // configured — apps that don't pass firebase/allowlist to
    // VoiceApp.init() get the same chrome as before this feature existed.
    const authMarkup = this.auth
      ? `<span id="auth-status"></span><button id="sign-in-btn">Sign in</button>`
      : '';

    shadow.innerHTML = `
      <style>
        :host { all: initial; position: fixed; bottom: 12px; right: 12px; font-family: sans-serif; z-index: 2147483647; }
        button { margin-left: 6px; }
        #mic-indicator { display:inline-block; width:10px; height:10px; border-radius:50%; background:#999; margin-right:6px; vertical-align:middle; }
        #mic-indicator.listening { background:#3b82f6; }
        #mic-indicator.recording { background:#ef4444; }
        #auth-status { font-size:12px; margin-right:6px; }
        #log-panel { position:absolute; bottom:36px; right:0; background:#fff; border:1px solid #ccc; max-height:240px; overflow:auto; min-width:220px; }
        #log-panel[hidden] { display:none; }
      </style>
      <span id="mic-indicator" class="idle"></span>
      ${authMarkup}
      <button id="undo-btn">Undo</button>
      <button id="log-tab">Log</button>
      <div id="log-panel" hidden></div>
    `;

    (target || document.body).appendChild(host);

    this.bindElements({
      undoBtn: shadow.getElementById('undo-btn'),
      logTab: shadow.getElementById('log-tab'),
      micIndicator: shadow.getElementById('mic-indicator'),
      logPanel: shadow.getElementById('log-panel'),
      signInBtn: shadow.getElementById('sign-in-btn'),
      authStatus: shadow.getElementById('auth-status'),
    });

    this.host = host;
    return host;
  }

  async handleUndoClick() {
    if (!this.undoStack || !this.undoStack.canUndo()) return;
    await this.undoStack.undo();
    this.updateUndoState();
    if (this.logPanelOpen) this.renderLog();
  }

  updateUndoState() {
    if (!this.elements.undoBtn) return;
    this.elements.undoBtn.disabled = !(this.undoStack && this.undoStack.canUndo());
  }

  toggleLogPanel() {
    this.logPanelOpen = !this.logPanelOpen;
    if (this.elements.logPanel) {
      this.elements.logPanel.hidden = !this.logPanelOpen;
    }
    if (this.logPanelOpen) this.renderLog();
    return this.logPanelOpen;
  }

  // Returns a plain view-model array (testable without a real DOM) and, if
  // a log panel element is bound, also renders it there.
  renderLog() {
    const entries = this.commandLog ? this.commandLog.getEntries() : [];
    const rows = entries.map((e) => ({
      id: e.id,
      label: `${e.type}${e.transcript ? ': ' + e.transcript : ''}`,
    }));

    if (this.elements.logPanel) {
      this.elements.logPanel.innerHTML = rows
        .map((r) => `<div data-log-id="${r.id}">${r.label}</div>`)
        .join('');
    }

    return rows;
  }

  // Real sign-in requires a user gesture (Safari blocks non-gesture
  // popups), so this must be triggered from a click — never from the
  // command dispatcher. Errors (e.g. the user closing the popup) are
  // logged, not thrown, since there's no caller to catch a click handler's
  // rejection.
  async handleSignInClick() {
    if (!this.auth) return;
    try {
      if (this.auth.isSignedIn()) {
        await this.auth.signOut();
      } else {
        await this.auth.signInWithGooglePopup();
      }
    } catch (err) {
      console.error('Sign-in error:', err);
    }
    this.updateAuthState();
  }

  updateAuthState() {
    if (!this.auth || !this.elements.signInBtn) return;
    const signedIn = this.auth.isSignedIn();
    this.elements.signInBtn.textContent = signedIn ? 'Sign out' : 'Sign in';
    if (this.elements.authStatus) {
      const user = this.auth.getUser();
      this.elements.authStatus.textContent = signedIn && user?.email ? user.email : '';
    }
  }

  setMicState(state) {
    if (!MIC_STATES.includes(state)) {
      throw new Error(`Unknown mic state: ${state}`);
    }
    if (this.elements.micIndicator) {
      this.elements.micIndicator.className = state;
    }
  }
}

export function createUI(config) {
  return new UI(config);
}
