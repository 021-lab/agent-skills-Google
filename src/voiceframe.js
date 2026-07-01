// VoiceApp: Public API for voice-controlled web applications
// Entry point for framework initialization and application integration

import { createDispatcher } from './core/dispatcher.js';
import { createVoiceIO } from './core/voice.js';
import { createAuth } from './core/auth.js';
import { createLocalDB } from './core/db.js';
import { createSync } from './core/sync.js';
import { createDrive } from './core/drive.js';
import { createUndoStack, recordPutMutation, recordDeleteMutation } from './core/undo.js';
import { createCommandLog } from './core/log.js';
import { createAI } from './core/ai.js';
import { createEmulator } from './core/emulate.js';

export class VoiceApp {
  constructor() {
    this.dispatcher = null;
    this.voiceIO = null;
    this.auth = null;
    this.db = null;
    this.sync = null;
    this.drive = null;
    this.undoStack = null;
    this.commandLog = null;
    this.ai = null;
    this.emulator = null;
    this.handler = null;
    this.initialized = false;
    this.config = null;
  }

  static async init(config = {}) {
    const app = new VoiceApp();
    await app.initialize(config);
    return app;
  }

  async initialize(config = {}) {
    this.config = config;

    // Local storage has no user dependency and is safe to open immediately.
    if (config.idb || typeof indexedDB !== 'undefined') {
      this.db = await createLocalDB(config.idb);
    }

    // Undo stack and command log have no user dependency either; every
    // command (user and agent) is logged regardless of auth/storage config.
    this.undoStack = createUndoStack();
    this.commandLog = createCommandLog({ localDB: this.db });

    // AI (Gemini) is optional per-app: only wired up if a client is supplied.
    if (config.geminiClient) {
      this.ai = createAI({ client: config.geminiClient, model: config.geminiModel });
    }

    // Auth must be established before any data-facing capability is wired up.
    if (config.firebase && config.allowlist) {
      this.auth = await createAuth({
        googleClientId: config.googleClientId,
        firebase: config.firebase,
        allowlist: config.allowlist,
      });

      // Cloud sync and Drive are per-user; wire them up once a user is known,
      // and tear them down again on sign-out so no data leaks across accounts.
      this.auth.onChange(({ state, user }) => {
        if (state === 'signed-in' && user) {
          this._wireUserData(user).catch(err => console.error('Failed to wire user data:', err));
        } else {
          this._unwireUserData();
        }
      });

      if (this.auth.isSignedIn()) {
        await this._wireUserData(this.auth.getUser());
      }
    }

    // Initialize voice I/O
    this.voiceIO = await createVoiceIO();

    // Initialize dispatcher with integrated voice handling
    this.dispatcher = await createDispatcher(this.handleCommand.bind(this));

    // Agent-emulation API: drives the page through the same handler as real
    // user input (see SPEC.md "The agent-emulation API").
    this.emulator = createEmulator({
      dispatchCommand: this._dispatchEmulatedCommand.bind(this),
      requireAuth: () => { if (this.auth) this.auth.requireAuth(); },
    });

    // Reachable on window.__voiceframe in debug mode (local driving, and an
    // agent's networked sandbox reaching in against the deployed URL).
    if (config.debug && typeof window !== 'undefined') {
      this.emulator.exposeOnWindow(window);
    }

    this.initialized = true;
    return this;
  }

  async _wireUserData(user) {
    if (this.db && this.config.firestore) {
      this.sync = await createSync({
        localDB: this.db,
        firestore: this.config.firestore,
        uid: user.uid,
      });
      this.sync.start();
    }

    if (this.config.driveClient) {
      this.drive = await createDrive({ client: this.config.driveClient, appId: this.config.appId });
    }
  }

  _unwireUserData() {
    if (this.sync) {
      this.sync.stop();
      this.sync = null;
    }
    this.drive = null;
  }

  // Wraps LocalDB so every put/delete auto-records its inverse on the undo
  // stack, per SPEC.md: "ctx.db local DB API; mutations auto-record on the
  // undo stack" and "Push every mutation onto the undo stack."
  _createTrackedDB() {
    if (!this.db) return null;
    const db = this.db;
    const undoStack = this.undoStack;
    return {
      async put(storeName, record) {
        const previousValue = await db.get(storeName, record.id);
        const saved = await db.put(storeName, record);
        undoStack.push(recordPutMutation({ db, storeName, id: record.id, previousValue, newValue: saved }));
        return saved;
      },
      async delete(storeName, id) {
        const previousValue = await db.get(storeName, id);
        await db.delete(storeName, id);
        undoStack.push(recordDeleteMutation({ db, storeName, id, previousValue }));
      },
      async get(storeName, id) {
        return db.get(storeName, id);
      },
      async getAll(storeName) {
        return db.getAll(storeName);
      },
    };
  }

  // Logs the command (user or agent, per SPEC.md: "Log every command"), then
  // wires ctx.db/drive/interpret/log for the app handler. Shared by both the
  // live dispatch path (handleCommand) and the emulation path (emulate()).
  async _wireCommandContext(ctx) {
    const selector = ctx.selector ?? (ctx.element && ctx.element.id ? `#${ctx.element.id}` : null);
    const logEntry = await this.commandLog.record({
      selector,
      type: ctx.type,
      transcript: ctx.transcript,
    });

    ctx.db = this._createTrackedDB();
    ctx.drive = this.drive;
    ctx.interpret = this.interpret.bind(this);
    ctx.log = (detail) => this.commandLog.attachDetail(logEntry.id, detail);
    ctx._logEntry = logEntry;
    return ctx;
  }

  handle(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    this.handler = handler;
  }

  async handleCommand(ctx) {
    // Require Google authentication before any command reaches app code or I/O.
    if (this.auth) {
      this.auth.requireAuth();
    }

    // If type is "say" and no transcript was supplied yet, capture voice input.
    // A pre-supplied transcript (e.g. from a test harness driving handleCommand
    // directly) means capture has already happened upstream — skip re-listening.
    if (ctx.type === 'say' && !ctx.transcript) {
      try {
        // Start listening for speech
        await this.voiceIO.startListening();

        // Optional: capture raw audio if requested
        if (this.config.captureAudio) {
          await this.voiceIO.startRecording();
        }

        // Wait for transcription to complete (Web Speech API async)
        await new Promise(resolve => {
          const checkTranscript = setInterval(() => {
            const transcript = this.voiceIO.transcript;
            if (transcript) {
              clearInterval(checkTranscript);
              ctx.transcript = transcript;
              resolve();
            }
          }, 100);

          // Timeout after 30s
          setTimeout(() => {
            clearInterval(checkTranscript);
            resolve();
          }, 30000);
        });

        // Stop recording if active
        if (this.config.captureAudio) {
          ctx.audioBlob = this.voiceIO.stopRecording();
        }
      } catch (err) {
        console.error('Voice capture error:', err);
      }
    }

    // Log this command and wire ctx.db/drive/interpret/log
    await this._wireCommandContext(ctx);

    // Call the application handler
    if (this.handler) {
      await this.handler(ctx);
    }
  }

  async interpret(transcript, schema) {
    if (!this.ai) {
      throw new Error('interpret() requires geminiClient to be configured on VoiceApp.init()');
    }
    return this.ai.interpret(transcript, schema);
  }

  async summarize(text) {
    if (!this.ai) {
      throw new Error('summarize() requires geminiClient to be configured on VoiceApp.init()');
    }
    return this.ai.summarize(text);
  }

  // Dispatches an emulated command through the same context wiring (log,
  // tracked db, drive, interpret) and the same app handler as live input —
  // no separate code path, so E2E assertions against emulate() are meaningful.
  async _dispatchEmulatedCommand(ctx) {
    await this._wireCommandContext(ctx);
    if (this.handler) {
      await this.handler(ctx);
    }
  }

  // Programmatic command dispatch for testing and agents, locally or over
  // the network against a deployed URL. {selector, type, transcript, expected?}
  async emulate(command) {
    return this.emulator.run(command);
  }
}

// Export framework for use in applications
export default VoiceApp;
