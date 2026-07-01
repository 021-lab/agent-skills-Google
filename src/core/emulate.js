// emulate.js: agent-emulation API — drives the page programmatically, locally
// or over the network against a deployed URL, through the exact same code
// path as a real user action (see SPEC.md "The agent-emulation API").

export class Emulator {
  constructor({ dispatchCommand, requireAuth } = {}) {
    if (typeof dispatchCommand !== 'function') {
      throw new Error('Emulator requires a dispatchCommand function');
    }
    this.dispatchCommand = dispatchCommand;
    this.requireAuth = requireAuth || (() => {});
  }

  // command: {selector, type, transcript, audioBlob, expected?}
  async run(command) {
    if (!command || !command.selector) {
      throw new Error('emulate() requires selector');
    }

    const element = document.querySelector(command.selector);
    if (!element) {
      throw new Error(`Element not found: ${command.selector}`);
    }

    this.requireAuth();

    const ctx = {
      element,
      selector: command.selector,
      type: command.type || 'say',
      transcript: command.transcript || null,
      audioBlob: command.audioBlob || null,
    };

    await this.dispatchCommand(ctx);

    return { success: true, context: ctx };
  }

  // Exposes this emulator on window.__voiceframe for local debug-mode driving
  // and for an agent's networked sandbox to reach via injected script /
  // remote-debugging protocol against the deployed URL.
  exposeOnWindow(target = window) {
    target.__voiceframe = target.__voiceframe || {};
    target.__voiceframe.emulate = this.run.bind(this);
  }
}

export function createEmulator(config) {
  return new Emulator(config);
}
