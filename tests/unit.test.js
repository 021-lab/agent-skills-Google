import { describe, it } from 'node:test';
import assert from 'node:assert';
import { VoiceApp } from '../src/voiceframe.js';

describe('VoiceApp', () => {
  describe('constructor', () => {
    it('should create a VoiceApp instance', () => {
      const app = new VoiceApp();
      assert.ok(app instanceof VoiceApp);
    });

    it('should accept configuration', () => {
      const config = { projectId: 'test-project' };
      const app = new VoiceApp(config);
      assert.deepEqual(app.config, config);
    });

    it('should start with initialized=false', () => {
      const app = new VoiceApp();
      assert.strictEqual(app.initialized, false);
    });
  });

  describe('init', () => {
    it('should initialize async', async () => {
      const app = await VoiceApp.init({ projectId: 'test-project' });
      assert.ok(app.initialized);
      assert.ok(app instanceof VoiceApp);
    });
  });

  describe('handle', () => {
    it('should throw if not initialized', () => {
      const app = new VoiceApp();
      assert.throws(
        () => app.handle({ type: 'tap' }),
        /not initialized/i
      );
    });

    it('should handle commands after initialization', async () => {
      const app = await VoiceApp.init();
      // Should not throw
      app.handle({ type: 'unknown' });
      assert.ok(true);
    });
  });

  describe('on', () => {
    it('should register command handlers', async () => {
      const app = await VoiceApp.init();
      let called = false;

      app.on('test', () => {
        called = true;
      });

      app.handle({ type: 'test' });
      assert.strictEqual(called, true);
    });
  });

  describe('emulate', () => {
    it('should emulate commands', async () => {
      const app = await VoiceApp.init();
      const result = await app.emulate({ type: 'tap' });
      assert.ok(result !== undefined);
    });
  });
});
