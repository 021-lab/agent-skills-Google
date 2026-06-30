import test from 'node:test';
import assert from 'node:assert';
import { Dispatcher } from '../src/core/dispatcher.js';

// Mock browser APIs for Node.js environment
if (typeof global.MutationObserver === 'undefined') {
  global.MutationObserver = class {
    constructor() {}
    observe() {}
    disconnect() {}
  };
}

test('Dispatcher: tap detection', () => {
  let capturedCommand = null;
  const handler = async (ctx) => {
    capturedCommand = ctx;
  };

  const dispatcher = new Dispatcher(handler);

  // Create mock element
  const mockElement = {
    matches: () => true,
    closest: () => mockElement,
    style: {},
  };

  // Simulate quick tap (< 500ms)
  const touchStartEvent = {
    target: { closest: () => mockElement },
    touches: [{ clientX: 100, clientY: 100 }],
    preventDefault: () => {},
  };

  const touchEndEvent = {
    target: { closest: () => mockElement },
    touches: [{ clientX: 100, clientY: 100 }],
    preventDefault: () => {},
  };

  dispatcher.touchStart = {
    timestamp: Date.now() - 200, // 200ms ago
    element: mockElement,
    clientX: 100,
    clientY: 100,
  };
  dispatcher.currentElement = mockElement;

  dispatcher.handleTouchEnd(touchEndEvent);

  assert.strictEqual(capturedCommand.type, 'tap', 'Quick touch should be classified as tap');
  assert.strictEqual(capturedCommand.element, mockElement);
});

test('Dispatcher: hold detection', () => {
  let capturedCommand = null;
  const handler = async (ctx) => {
    capturedCommand = ctx;
  };

  const dispatcher = new Dispatcher(handler);

  // Create mock element
  const mockElement = {
    matches: () => true,
    closest: () => mockElement,
    style: {},
  };

  // Simulate long hold (>= 500ms)
  dispatcher.touchStart = {
    timestamp: Date.now() - 600, // 600ms ago
    element: mockElement,
    clientX: 100,
    clientY: 100,
  };
  dispatcher.currentElement = mockElement;

  const touchEndEvent = {
    target: { closest: () => mockElement },
    touches: [{ clientX: 100, clientY: 100 }],
    preventDefault: () => {},
  };

  dispatcher.handleTouchEnd(touchEndEvent);

  assert.strictEqual(capturedCommand.type, 'say', 'Long hold should be classified as say');
});

test('Dispatcher: move cancels hold detection', () => {
  let capturedCommand = null;
  const handler = async (ctx) => {
    capturedCommand = ctx;
  };

  const dispatcher = new Dispatcher(handler);

  const mockElement = {
    matches: () => true,
    closest: () => mockElement,
    style: {},
  };

  dispatcher.touchStart = {
    timestamp: Date.now() - 600,
    element: mockElement,
    clientX: 100,
    clientY: 100,
  };

  // Move significantly (> 10px)
  const touchMoveEvent = {
    touches: [{ clientX: 120, clientY: 100 }],
    preventDefault: () => {},
  };

  dispatcher.handleTouchMove(touchMoveEvent);

  assert.strictEqual(dispatcher.touchStart, null, 'Touch start should be cancelled on significant move');
});

test('Dispatcher: command context structure', async () => {
  let capturedCommand = null;
  const handler = async (ctx) => {
    capturedCommand = ctx;
  };

  const dispatcher = new Dispatcher(handler);

  const mockElement = { style: {} };
  dispatcher.touchStart = {
    timestamp: Date.now() - 200,
    element: mockElement,
    clientX: 100,
    clientY: 100,
  };
  dispatcher.currentElement = mockElement;

  const touchEndEvent = {
    target: { closest: () => mockElement },
    touches: [{ clientX: 100, clientY: 100 }],
    preventDefault: () => {},
  };

  dispatcher.handleTouchEnd(touchEndEvent);

  assert.strictEqual(typeof capturedCommand.element, 'object', 'Context should have element');
  assert.strictEqual(typeof capturedCommand.type, 'string', 'Context should have type');
  assert.strictEqual(capturedCommand.transcript, null, 'Context should have transcript (null initially)');
  assert.strictEqual(capturedCommand.audioBlob, null, 'Context should have audioBlob (null initially)');
});
