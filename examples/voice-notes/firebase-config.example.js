// Copy this file to firebase-config.js (gitignored — never commit real
// keys) and fill in your own values from your Firebase/Google Cloud
// project. See REAL-KEYS.md for exactly where each value comes from.
//
// Then add ONE line to index.html, before the app.js <script> tag:
//
//   <script type="module" src="/examples/voice-notes/firebase-config.js"></script>
//
// This file constructs real Google/Firebase adapters via the framework's
// google-sdk.js (never imported by app.js itself — see SPEC.md: app code
// must never perform its own I/O) and assigns them to
// window.__voiceNotesConfig, which app.js already reads.
import { createFirebaseAdapter, createGeminiAdapter, createDriveAdapter } from '/src/core/google-sdk.js';

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

// Only these emails may sign in (SPEC.md: "Google login mandatory,
// restricted to the allowlist"). Lowercase, matches case-insensitively.
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
