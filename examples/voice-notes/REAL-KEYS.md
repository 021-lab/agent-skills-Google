# Setting up Voice Notes with real Google/Firebase credentials

A from-scratch walkthrough: create the Google/Firebase project, lock it
down so **only specific emails can sign in — enforced by Google's own
server, not by this app's code** — and wire the real config into
`firebase-config.js` so it's just fill-in-the-blanks.

This app is normally driven by mocked Firebase/Gemini/Drive clients (see
`tests/voice-notes.e2e.spec.js`). This doc is for running it against real
credentials instead.

## The security model, up front

Two allowlists exist in this setup, and they are **not equally strong**:

| Layer | Where | Enforced by | Bypassable? |
|---|---|---|---|
| **Google Test users list** | Google Cloud Console → OAuth consent screen | Google's own servers, before any token is issued | No — this is the real gate |
| `ALLOWLIST` array in `firebase-config.js` | This app's client-side JS | `src/core/auth.js`, in the browser | Yes, in principle, by anyone who writes their own script against your public `firebaseConfig` |

**This doc sets up the Google Test users list as the real access boundary.**
Because of that, `firebaseConfig` (`apiKey`, `authDomain`, `projectId`, …)
can safely live in your public repo — those values identify your project,
they are not secrets Google expects you to hide (this is standard Firebase
practice), and Google itself will refuse to complete sign-in for anyone
not on your Test users list, regardless of who has read your source code.
Keep the `ALLOWLIST` array too — it's a second, redundant layer (defense
in depth) and gives nicer in-app error messages, but it is not what's
actually stopping an unauthorized person.

## Part 1 — Create the project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project** → follow the wizard (Google Analytics is optional, skip
   it if you don't need it).
2. In the new project, go to **Build → Authentication** → **Get started** →
   under **Sign-in method**, enable **Google**.
3. Still in Authentication, go to **Settings → Authorized domains** and
   confirm `localhost` is listed (Firebase adds it automatically for new
   projects — check, don't assume).

## Part 2 — The real allowlist: Google Test users

This is the step that actually restricts who can sign in.

1. Open [console.cloud.google.com](https://console.cloud.google.com) and
   select the **same project** (Firebase projects are Google Cloud
   projects — no separate project to create).
2. Go to **APIs & Services → OAuth consent screen**.
3. Confirm **Publishing status** is **Testing** (this is the default for a
   new project — leave it this way; do *not* click "Publish App").
   In Testing status, Google restricts sign-in to an explicit list of
   testers instead of the general public.
4. Under **Test users**, click **Add users** and add the Google account
   email(s) that should be allowed to use the app (yourself + friends, up
   to 100). This list lives entirely in Google Cloud Console — it is not
   part of this repo and never gets committed.
5. To confirm it's working later: have someone whose email is *not* on
   this list try to sign in. They should see Google's own
   "Access blocked: this app has not completed the Google verification
   process" page inside the popup, and the app will show the same message
   in its own UI (the error box next to the Sign in button —
   `src/core/ui.js` surfaces whatever `signInWithGooglePopup()` rejects
   with).

> **Note:** I have not verified live the exact wording/behavior Google
> shows in every case (this has changed over time), nor the precise token
> lifetime limits some Google docs mention for Testing-status apps. Both
> are worth a quick sanity check in your own console before depending on
> this for anything beyond personal/friends use — see "What this doesn't
> prove" below.

## Part 3 — Enable the APIs the app uses

Same Google Cloud project, **APIs & Services → Library**:

1. Search **Google Drive API** → **Enable**.
2. In the Firebase console (not Cloud console), go to **Build → AI Logic**
   (the exact menu label has varied across console versions) and follow
   its setup flow to enable Gemini access for this project. No separate
   API key needed — `createGeminiAdapter()` in `src/core/google-sdk.js`
   authenticates through the same Firebase app your users sign into.

## Part 4 — Authorized JavaScript origins

Separate from the Test users list — this restricts *which pages* are
allowed to open the sign-in popup at all, regardless of who's signing in.
Google requires an explicit list here; it cannot be left blank or
wildcarded.

1. **APIs & Services → Credentials** → find the OAuth 2.0 Client ID
   Firebase created for you (listed under "OAuth 2.0 Client IDs").
2. Under **Authorized JavaScript origins**, add every origin you'll run
   the app from, e.g. `http://localhost:4173` (adjust the port to
   whatever you serve on). Add more later (e.g. a real deployed domain)
   as needed — this list can be edited any time.

## Part 5 — Fill in the config

Get your `firebaseConfig`: **Project settings → General → Your apps** →
add a Web app if you haven't → copy the object shown (6 fields: `apiKey`,
`authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`).

```bash
cd examples/voice-notes
cp firebase-config.example.js firebase-config.js
```

Edit `firebase-config.js`: paste in the 6 `firebaseConfig` fields, and put
the same email(s) from Part 2's Test users list into `ALLOWLIST`.

`firebase-config.js` is gitignored by default (see `.gitignore`:
`examples/*/firebase-config.js`) — that's just a starting default, not a
requirement. Since Part 2 makes Google's Test users list the real gate,
committing this file with real values is a reasonable, informed choice if
you want the config in your public repo:

```bash
git add -f examples/voice-notes/firebase-config.js
```

Add one line to `index.html`, **before** the existing `app.js` script tag:

```html
<script type="module" src="/examples/voice-notes/firebase-config.js"></script>
<script type="module" src="/examples/voice-notes/app.js"></script>
```

(Only needed for this manual/real-keys run — the existing automated tests
inject their mock config a different way and don't need this line.)

## Part 6 — Run it

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

**Proves:** the real OAuth popup flow, Google's Test-users gate rejecting
non-allowlisted accounts (with a visible error in the app, not just a
silent popup close), real Gemini summarization, and real Drive file
creation all work together end to end.

**Does not prove:** iOS Safari-specific behavior (Web Speech reliability,
mic contention between `MediaRecorder` and `webkitSpeechRecognition`,
PWA-standalone Web Speech restrictions) — those need the real-device
smoke test SPEC.md calls out separately from this harness. Also unverified
live in this environment: the exact Firebase CDN version pinned in
`src/core/google-sdk.js` (check against
[firebase.google.com/docs/web/setup](https://firebase.google.com/docs/web/setup)
if modules fail to load), and the precise Testing-status token-lifetime
behavior mentioned in Part 2.

## If something doesn't work

- **"Access blocked" in the popup, for an email that IS on the Test users
  list** — double-check you added it under the exact right Google Cloud
  project (easy to mix up if you have several), and that you're signing in
  with that exact Google account (not a different one logged into the
  same browser profile).
- **Popup blocked by the browser** — Safari/Chrome require the click to
  directly trigger the popup; this is already how the Sign in button is
  wired, but browser popup blockers can still be aggressive. Try allowing
  popups for the page.
- **`Drive API error 403`** — check the Drive API is enabled (Part 3) and
  that sign-in actually requested the `drive.file` scope (it does by
  default in `createFirebaseAdapter`).
- **`No Google Drive access token available`** — you're signed in via
  Firebase but the OAuth popup didn't return a Google access token; sign
  out and sign in again — this can happen if a cached Firebase session
  restores without the Drive scope having been granted in this browser
  session.
