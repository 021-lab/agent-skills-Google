# Voice Notes Stable E2E

This repo now runs the real Voice Notes smoke test against a stable Firebase Hosting site instead of a branch preview URL.

## What changed

- GitHub Actions deploys Voice Notes to a deterministic Hosting site derived from `FIREBASE_PROJECT_ID`:
  `https://<project-id>-e2e.web.app/examples/voice-notes/index.html`
- The workflow uses the existing Firebase service account secret to:
  - ensure the Hosting site exists
  - deploy the current branch there
  - add the stable `web.app` / `firebaseapp.com` hosts to Firebase Auth authorized domains
- CI no longer drives the Google popup on every push. It restores a real signed-in browser session from Playwright `storageState`.

## One-time local setup

1. Open [docs/voice-notes-e2e-auth.html](/Users/AIDev/Codex/firebase-voice-framework%20/docs/voice-notes-e2e-auth.html).
2. Enter the Firebase project id from the GitHub secret `FIREBASE_PROJECT_ID`.
3. Run:

```bash
FIREBASE_PROJECT_ID=<project-id> npm --prefix /Users/AIDev/Codex/firebase-voice-framework run e2e:auth:save
```

4. Sign in with the real allowlisted Google account on the opened stable URL.
5. The script saves:

```text
playwright/.auth/voice-notes-google.json
```

6. Upload that session into GitHub Actions:

```bash
npm --prefix /Users/AIDev/Codex/firebase-voice-framework run e2e:auth:upload-secret
```

That command updates the GitHub Actions secret `E2E_PLAYWRIGHT_STORAGE_STATE_B64`.

## Secrets now used by CI

- `GCP_PRIVATE_KEY_JSON`
- `E2E_GOOGLE_EMAIL`
- `E2E_PLAYWRIGHT_STORAGE_STATE_B64`
- `FIREBASE_WEB_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`

## Notes

- The Google account used to create the session must still be on the real allowlist path:
  - Google OAuth test users
  - `E2E_GOOGLE_EMAIL`
  - the in-app allowlist generated into `firebase-config.js`
- If the saved session expires, repeat the same two commands and upload a fresh state file.
