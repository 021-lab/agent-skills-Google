// Voice Notes: the framework's acceptance-test app (SPEC.md "Acceptance
// Test — Voice Notes app"). One HTML contract (#record), one command
// handler — every capability (voice, auth, storage, Drive, Gemini) comes
// from the framework; this file performs no I/O of its own.
import { VoiceApp } from '/src/voiceframe.js';

async function waitForRuntimeConfig() {
  const bootstrap = window.__voiceNotesBootstrap;
  if (!bootstrap) return window.__voiceNotesConfig || {};

  const timeoutMs = 15000;
  const startedAt = Date.now();
  while (true) {
    const state = window.__voiceNotesBootstrap;
    if (!state || state.status === 'ready') {
      return window.__voiceNotesConfig || {};
    }
    if (state.status === 'error') {
      throw new Error(state.message || 'Voice Notes bootstrap failed');
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for Voice Notes runtime config');
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

// Environment-specific config (real Firebase/Google credentials, or test
// mocks) is injected by the host page, never hardcoded here — see SPEC.md
// "Never: Commit secrets or API keys."
const runtimeConfig = await waitForRuntimeConfig();

const app = await VoiceApp.init({
  ui: runtimeConfig.ui,
  debug: runtimeConfig.debug,
  firebase: runtimeConfig.firebase,
  allowlist: runtimeConfig.allowlist,
  googleClientId: runtimeConfig.googleClientId,
  geminiClient: runtimeConfig.geminiClient,
  driveClient: runtimeConfig.driveClient,
  appId: 'voice-notes',
  captureAudio: true,
});

app.handle(async (ctx) => {
  if (ctx.element.id !== 'record' || ctx.type !== 'say' || !ctx.transcript) return;

  const transcript = ctx.transcript;
  const title = await app.summarize(transcript);

  // Local record of the note, so it's undoable and shows up in the log —
  // per SPEC.md boundaries: "Push every mutation onto the undo stack."
  await ctx.db.put('mutations', { id: `note-${Date.now()}`, title, transcript });

  // Transcript text file.
  await ctx.drive.upload({
    name: `${title}.txt`,
    blob: { data: transcript, type: 'text/plain' },
    mimeType: 'text/plain',
  });

  // Audio file. On a real device this is the MediaRecorder blob captured
  // while #record was held; emulation-driven tests may not supply one.
  await ctx.drive.upload({
    name: `${title}.m4a`,
    blob: ctx.audioBlob || { data: null, type: 'audio/mp4' },
    mimeType: 'audio/mp4',
  });

  ctx.log({ title, transcript });
});

// Test-only hook — not part of the framework's public contract.
window.__voiceNotesApp = app;
