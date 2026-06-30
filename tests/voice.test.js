import test from 'node:test';
import assert from 'node:assert';
import { VoiceIO } from '../src/core/voice.js';

// Mock browser APIs for Node.js environment
if (typeof global.webkitSpeechRecognition === 'undefined') {
  global.webkitSpeechRecognition = class {
    constructor() {
      this.lang = null;
      this.interimResults = false;
      this.continuous = false;
      this.onstart = null;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
    }
    start() {
      if (this.onstart) this.onstart();
    }
    stop() {
      if (this.onend) this.onend();
    }
  };
}

if (typeof global.window === 'undefined') {
  global.window = {
    webkitSpeechRecognition: global.webkitSpeechRecognition,
    SpeechRecognition: null,
  };
}

test('VoiceIO: initialization', () => {
  const voiceIO = new VoiceIO();

  assert.strictEqual(voiceIO.state, 'idle', 'Initial state should be idle');
  assert.strictEqual(voiceIO.transcript, null, 'Initial transcript should be null');
  assert.strictEqual(voiceIO.audioBlob, null, 'Initial audioBlob should be null');
  assert.strictEqual(voiceIO.mediaRecorder, null, 'Initial mediaRecorder should be null');
});

test('VoiceIO: state tracking', () => {
  const voiceIO = new VoiceIO();

  assert.strictEqual(voiceIO.getState(), 'idle');

  voiceIO.state = 'listening';
  assert.strictEqual(voiceIO.getState(), 'listening');

  voiceIO.state = 'recording';
  assert.strictEqual(voiceIO.getState(), 'recording');
});

test('VoiceIO: transcript getter', async () => {
  const voiceIO = new VoiceIO();

  voiceIO.transcript = 'test transcript';
  const result = await voiceIO.getTranscript();
  assert.strictEqual(result, 'test transcript');
});

test('VoiceIO: recognition language config', () => {
  const voiceIO = new VoiceIO();

  assert.strictEqual(voiceIO.recognition.lang, 'ru-RU', 'Should set Russian language');
  assert.strictEqual(voiceIO.recognition.continuous, false, 'Should disable continuous mode');
  assert.strictEqual(voiceIO.recognition.interimResults, false, 'Should not enable interim results');
});

test('VoiceIO: recognition handlers initialized', () => {
  const voiceIO = new VoiceIO();

  assert.strictEqual(typeof voiceIO.recognition.onstart, 'function', 'onstart should be a function');
  assert.strictEqual(typeof voiceIO.recognition.onresult, 'function', 'onresult should be a function');
  assert.strictEqual(typeof voiceIO.recognition.onerror, 'function', 'onerror should be a function');
  assert.strictEqual(typeof voiceIO.recognition.onend, 'function', 'onend should be a function');
});

test('VoiceIO: error handling returns to idle', () => {
  const voiceIO = new VoiceIO();
  voiceIO.state = 'listening';

  // Trigger error handler
  voiceIO.recognition.onerror({ error: 'network' });

  assert.strictEqual(voiceIO.state, 'idle', 'Should return to idle state on error');
});

test('VoiceIO: mediaRecorder state management', () => {
  const voiceIO = new VoiceIO();

  assert.strictEqual(voiceIO.mediaRecorder, null, 'mediaRecorder should start as null');

  // Simulate setting mediaRecorder
  voiceIO.mediaRecorder = {
    start: () => {},
    stop: () => {},
    ondataavailable: null,
    onstop: null,
  };

  assert.strictEqual(voiceIO.mediaRecorder !== null, true, 'mediaRecorder can be assigned');
});
