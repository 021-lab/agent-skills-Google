// ui.js: injected chrome — Undo button, Log tab, mic/recording indicator.
// DOM creation (mount) is isolated from the state/render logic below it so
// the logic is unit-testable without a real DOM; mount() is exercised by a
// Playwright E2E test against a real page instead.

const MIC_STATES = ['idle', 'listening', 'recording'];

export class UI {
  constructor({ undoStack, commandLog, voiceIO } = {}) {
    this.undoStack = undoStack;
    this.commandLog = commandLog;
    this.voiceIO = voiceIO;
    this.elements = { undoBtn: null, logTab: null, micIndicator: null, logPanel: null };
    this.logPanelOpen = false;
    this.host = null;
  }

  // Binds this UI to already-created DOM-like elements. Used by mount() for
  // real DOM, and directly by unit tests with lightweight element mocks.
  bindElements(elements) {
    this.elements = elements;

    if (this.elements.undoBtn) {
      this.elements.undoBtn.addEventListener('click', () => this.handleUndoClick());
    }
    if (this.elements.logTab) {
      this.elements.logTab.addEventListener('click', () => this.toggleLogPanel());
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

    shadow.innerHTML = `
      <style>
        :host { all: initial; position: fixed; bottom: 12px; right: 12px; font-family: sans-serif; z-index: 2147483647; }
        button { margin-left: 6px; }
        #mic-indicator { display:inline-block; width:10px; height:10px; border-radius:50%; background:#999; margin-right:6px; vertical-align:middle; }
        #mic-indicator.listening { background:#3b82f6; }
        #mic-indicator.recording { background:#ef4444; }
        #log-panel { position:absolute; bottom:36px; right:0; background:#fff; border:1px solid #ccc; max-height:240px; overflow:auto; min-width:220px; }
        #log-panel[hidden] { display:none; }
      </style>
      <span id="mic-indicator" class="idle"></span>
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
