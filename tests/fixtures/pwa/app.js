// Minimal fixture used only by tests/pwa.e2e.spec.js to prove the service
// worker (auto-registered by VoiceApp.init(), see voiceframe.js) caches
// same-origin assets and serves them when offline.
import { VoiceApp } from '/src/voiceframe.js';

const app = await VoiceApp.init({ ui: false });

window.__voiceframeApp = app;
