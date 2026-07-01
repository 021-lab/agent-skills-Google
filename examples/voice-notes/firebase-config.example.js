// Copy this file to firebase-config.js and fill in your own values from
// your Firebase/Google Cloud project. See REAL-KEYS.md for exactly where
// each value comes from and how to set up the project from scratch.
//
// Then add ONE line to index.html, before the app.js <script> tag:
//
//   <script type="module" src="/examples/voice-notes/firebase-config.js"></script>
//
// This file constructs real Google/Firebase adapters via the framework's
// google-sdk.js (never imported by app.js itself — see SPEC.md: app code
// must never perform its own I/O) and assigns them to
// window.__voiceNotesConfig, which app.js already reads.
//
// ON PUBLISHING THIS FILE: firebase-config.js is gitignored by default,
// but that's a starting point, not a requirement. The values below
// (apiKey, authDomain, ...) are not secrets Google expects hidden — the
// real access boundary is the Google Cloud OAuth consent screen's Test
// users list (REAL-KEYS.md Part 2), enforced by Google's own servers
// before sign-in even completes. If you've set that up, committing this
// file with real values (`git add -f firebase-config.js`) is a
// reasonable, informed choice. ALLOWLIST below is a secondary, redundant
// client-side layer for nicer error messages — not what's actually
// stopping an unauthorized person.
import { createFirebaseAdapter, createGeminiAdapter, createDriveAdapter } from '/src/core/google-sdk.js';

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// Secondary layer only — see the note above. The real allowlist is the
// Google Cloud OAuth consent screen's Test users list (REAL-KEYS.md Part 2).
// Lowercase, matches case-insensitively.
const ALLOWLIST = ['you@example.com'];

const { auth: firebaseAuth, firebaseApp } = await createFirebaseAdapter(firebaseConfig);
const geminiClient = await createGeminiAdapter({ firebaseApp });
const driveClient = createDriveAdapter(() => firebaseAuth.getAccessToken());

window.__voiceNotesConfig = {
  firebase: { auth: firebaseAuth },
  allowlist: ALLOWLIST,
  geminiClient,
  driveClient,
  debug: true, // exposes window.__voiceframe.emulate() for manual/agent testing
};
