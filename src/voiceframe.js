// VoiceApp: Public API for voice-controlled web applications
// Entry point for framework initialization and application integration

import { createDispatcher } from './core/dispatcher.js';
import { createVoiceIO } from './core/voice.js';
import { createAuth } from './core/auth.js';
import { createLocalDB } from './core/db.js';
import { createSync } from './core/sync.js';
import { createDrive } from './core/drive.js';

export class VoiceApp {
  constructor() {
    this.dispatcher = null;
    this.voiceIO = null;
    this.auth = null;
    this.db = null;
    this.sync = null;
    this.drive = null;
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

    // If type is "say", capture voice input
    if (ctx.type === 'say') {
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

    // Inject framework APIs into context
    ctx.interpret = this.interpret.bind(this);
    ctx.db = this.db;
    ctx.drive = this.drive;
    ctx.log = this.logCommand.bind(this);

    // Call the application handler
    if (this.handler) {
      await this.handler(ctx);
    }
  }

  async interpret(transcript, schema) {
    // Placeholder for Gemini integration (implemented in ai.js)
    console.log('interpret() called:', { transcript, schema });
    return null;
  }

  async logCommand(detail) {
    // Placeholder for command logging (implemented in log.js)
    console.log('logCommand() called:', detail);
  }

  async emulate(command) {
    // Programmatic command dispatch for testing and agents
    // {selector, type, transcript, expected?}
    if (!command.selector) {
      throw new Error('emulate() requires selector');
    }

    const element = document.querySelector(command.selector);
    if (!element) {
      throw new Error(`Element not found: ${command.selector}`);
    }

    const ctx = {
      element,
      type: command.type || 'say',
      transcript: command.transcript || null,
      audioBlob: command.audioBlob || null,
      interpret: this.interpret.bind(this),
      db: this.db,
      drive: this.drive,
      log: this.logCommand.bind(this),
    };

    if (this.handler) {
      await this.handler(ctx);
    }

    // Return observable state (to be enhanced when storage modules integrate)
    return {
      success: true,
      context: ctx,
    };
  }
}

// Export framework for use in applications
export default VoiceApp;
