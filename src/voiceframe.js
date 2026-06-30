// VoiceApp: Public API for voice-controlled web applications
// Entry point for framework initialization and application integration

import { createDispatcher } from './core/dispatcher.js';
import { createVoiceIO } from './core/voice.js';

export class VoiceApp {
  constructor() {
    this.dispatcher = null;
    this.voiceIO = null;
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

    // Initialize voice I/O
    this.voiceIO = await createVoiceIO();

    // Initialize dispatcher with integrated voice handling
    this.dispatcher = await createDispatcher(this.handleCommand.bind(this));

    this.initialized = true;
    return this;
  }

  handle(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    this.handler = handler;
  }

  async handleCommand(ctx) {
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
