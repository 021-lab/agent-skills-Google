// Input dispatcher: single code path for all user actions (tap/hold + speak)
// Routes every command through one handler, auto-wires dynamic [data-voice] elements

const HOLD_THRESHOLD_MS = 500;

export class Dispatcher {
  constructor(handler) {
    this.handler = handler;
    this.touchStart = null;
    this.currentElement = null;
    this.voiceActive = false;
  }

  init() {
    // Event delegation: listen at document level for [data-voice] elements
    document.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
    document.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
    document.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });

    // Auto-wire dynamically-created [data-voice] elements
    this.observeDynamicElements();
  }

  handleTouchStart(e) {
    const element = e.target.closest('[data-voice]');
    if (!element) return;

    this.touchStart = {
      timestamp: Date.now(),
      element,
      clientX: e.touches[0].clientX,
      clientY: e.touches[0].clientY,
    };
    this.currentElement = element;

    // Prevent native behaviors (long-press menu, context menu, zoom on double-tap)
    e.preventDefault();
    element.style.userSelect = 'none';
  }

  handleTouchMove(e) {
    if (!this.touchStart) return;

    // Cancel hold if user moves significantly (>10px)
    const dx = Math.abs(e.touches[0].clientX - this.touchStart.clientX);
    const dy = Math.abs(e.touches[0].clientY - this.touchStart.clientY);
    if (dx > 10 || dy > 10) {
      this.touchStart = null;
      e.preventDefault();
    }
  }

  handleTouchEnd(e) {
    if (!this.touchStart) return;

    const element = this.currentElement;
    const duration = Date.now() - this.touchStart.timestamp;
    const isHold = duration >= HOLD_THRESHOLD_MS;

    this.touchStart = null;
    this.currentElement = null;

    if (isHold) {
      // Dispatch "say" command (voice capture follows)
      this.dispatchCommand({ element, type: 'say' });
    } else {
      // Dispatch "tap" command
      this.dispatchCommand({ element, type: 'tap' });
    }

    e.preventDefault();
  }

  dispatchCommand(command) {
    // Build full command context
    const ctx = {
      element: command.element,
      type: command.type,
      transcript: command.transcript || null,
      audioBlob: command.audioBlob || null,
      // Will be populated by framework modules
      interpret: null,
      db: null,
      drive: null,
      log: null,
    };

    // Call the registered handler
    if (this.handler) {
      this.handler(ctx).catch(err => {
        console.error('Command handler error:', err);
      });
    }
  }

  observeDynamicElements() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check for newly added [data-voice] elements
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) { // Element node
              if (node.matches?.('[data-voice]')) {
                // Element added with [data-voice] - already auto-wired by event delegation
              }
              node.querySelectorAll?.('[data-voice]').forEach(() => {
                // Any children with [data-voice] are also auto-wired
              });
            }
          });
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  }
}

export async function createDispatcher(handler) {
  const dispatcher = new Dispatcher(handler);
  dispatcher.init();
  return dispatcher;
}
