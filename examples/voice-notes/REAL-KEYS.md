# Testing Voice Notes with real Google/Firebase credentials

This app is normally driven by mocked Firebase/Gemini/Drive clients (see
`tests/voice-notes.e2e.spec.js`). This doc covers the minimal steps to run
it against **real** Google credentials instead.

## 1. Get the credentials

All of this fits in the free tier for personal/testing use.

1. **Firebase project** — [console.firebase.google.com](https://console.firebase.google.com) →
   create a project. Under **Authentication → Sign-in method**, enable the
   **Google** provider.
2. **firebaseConfig** — Project settings → General → "Your apps" → add a
   Web app → copy the `firebaseConfig` object it shows you (6 fields:
   `apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`).
3. **OAuth consent + authorized origins** — Firebase projects share a
   Google Cloud project. In
   [console.cloud.google.com](https://console.cloud.google.com) (same
   project), under **APIs & Services → Credentials**, find the OAuth 2.0
   Client ID Firebase created for you (or create a "Web application" one)
   and add `http://localhost:4173` (or whatever port you serve on) to
   **Authorized JavaScript origins**.
4. **Enable the Drive API** — same Google Cloud project, **APIs & Services
   → Library** → search "Google Drive API" → Enable.
5. **Gemini API key / Firebase AI Logic** — in the Firebase console, under
   **Build → AI Logic** (naming may vary by console version), follow the
   setup flow to enable Gemini access for this project. No separate API
   key is needed with `createGeminiAdapter()` — it authenticates through
   the same Firebase app.
6. **Your email** — the one you'll sign in with; goes in the allowlist.

## 2. Configure the app

```bash
cd examples/voice-notes
cp firebase-config.example.js firebase-config.js
```

Edit `firebase-config.js`: paste in your `firebaseConfig` values and put
your email in `ALLOWLIST`. This file is gitignored — it will never be
committed.

Add one line to `index.html`, **before** the existing `app.js` script tag:

```html
<script type="module" src="/examples/voice-notes/firebase-config.js"></script>
<script type="module" src="/examples/voice-notes/app.js"></script>
```

(Only needed for this manual/real-keys run — the existing automated tests
inject their mock config a different way and don't need this line.)

## 3. Run it

```bash
npx serve .          # from the repo root
```

Open `http://localhost:PORT/examples/voice-notes/` in a browser (Safari on
an actual iPhone for the real target platform; any modern browser works
for a first check of the auth/Drive/Gemini wiring).

Click **Sign in** (bottom-right chrome, added by `src/core/ui.js`). Approve
the Google popup. Once signed in, press and hold **Record**, dictate a
note, release. Check your Google Drive — you should see two new files
titled from the AI summary.

## What this does and doesn't prove

**Proves:** the real OAuth popup flow, real Firebase Auth + allowlist gate,
real Gemini summarization, and real Drive file creation all work together
end to end.

**Does not prove:** iOS Safari-specific behavior (Web Speech reliability,
mic contention between `MediaRecorder` and `webkitSpeechRecognition`,
PWA-standalone Web Speech restrictions) — those need the real-device
smoke test SPEC.md calls out separately from this harness. Also: the exact
Firebase CDN version pinned in `src/core/google-sdk.js` has not been
verified against a live fetch in the environment this framework was built
in — if `firebase-config.js` fails to load Firebase modules, check that
version against [firebase.google.com/docs/web/setup](https://firebase.google.com/docs/web/setup)
first.

## If something doesn't work

- **Popup blocked** — Safari/Chrome require the click to directly trigger
  the popup; this is already how the Sign in button is wired, but browser
  popup blockers can still be aggressive. Try allowing popups for the
  page.
- **`Drive API error 403`** — check the Drive API is enabled (step 4) and
  that sign-in actually requested the `drive.file` scope (it does by
  default in `createFirebaseAdapter`).
- **`No Google Drive access token available`** — you're signed in via
  Firebase but the OAuth popup didn't return a Google access token; sign
  out and sign in again — this can happen if a cached Firebase session
  restores without the Drive scope having been granted in this browser
  session.
