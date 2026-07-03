# Handoff: Voice Web Application Framework

Status as of commit `64efb0f` on branch `claude/spec-implementation-plan-h4g0tu`.
Written for whoever (human or agent) picks this up next, so they don't have
to re-derive what was actually verified vs. assumed.

## What's built

The full framework from `SPEC.md`, implemented in 10 vertical slices plus
real-credential adapters added afterward:

```
src/voiceframe.js          VoiceApp public API
src/core/                  dispatcher, voice, auth, db, sync, drive, ai,
                            undo, log, emulate, ui, google-sdk (real adapters)
src/pwa/                   manifest + service worker
examples/voice-notes/      acceptance-test app (SPEC's "тестовое задание")
docs/framework-api.md      coder/agent-facing API reference
firebase.json, .firebaserc Hosting config + project alias (ai-labg)
```

**Tests: 198 passing** — 180 `node:test` unit tests, 18 Playwright E2E
tests (`npm test`, `npx playwright test`). All green as of this commit.

## What "tested" actually means here — read this before trusting green tests

Every test — unit and E2E alike — runs against **mocked** Firebase Auth,
Firestore, Gemini, and Drive clients. `tests/google-sdk.test.js` mocks
`fetch` and the dynamic `import()` of the Firebase SDK. **No test in this
suite has ever completed a real network call to Google.** That's not a gap
in the tests — it's a description of what they prove: the framework's
*logic* is correct (dispatch, auth-gating, undo, fixture replay, adapter
request/response shapes). It does not prove the real integration works.

## What was actually verified live (and how)

- `apiKey`/project validity for the real Firebase project **ai-labg**, via
  an unauthenticated REST call (`curl .../identitytoolkit/v3/relyingparty/getProjectConfig`)
  from this sandbox. Confirmed: key is valid, `localhost` is already in
  authorized domains.
- That's it. No sign-in, no Drive write, no Gemini call has been completed
  against real Google infrastructure from any session so far.

## Why real sign-in couldn't be completed from this sandbox

Diagnosed and confirmed, not assumed: Playwright's Chromium in this
environment cannot complete **any** outbound HTTPS connection, even to an
allowlisted domain (`registry.npmjs.org` → `ERR_CERT_AUTHORITY_INVALID`).
The session's egress proxy does TLS interception; `curl`/Node's own HTTPS
stack trust its CA correctly, this specific Chromium binary does not. This
blocks any browser-driven OAuth popup from this sandbox, full stop — not a
code bug, an environment gap. See conversation history for the diagnostic
trail if this needs revisiting (proxy config, NSS store, `~/.pki/nssdb`).

`firebase deploy` is blocked for a related but separate reason:
interactive `firebase login` needs the same broken browser flow. The
Firebase CLI itself (Node-based) should be able to deploy fine once
authenticated non-interactively — the blocker is *getting* a credential
in, not using one.

## Credentials: current state

- **Real `firebaseConfig`** (apiKey etc. for `ai-labg`) — given by the user
  in chat, saved locally at `examples/voice-notes/firebase-config.js`.
  Gitignored (`examples/*/firebase-config.js`), **not committed**. A zip
  bundle with this file included (and `index.html` pre-wired to load it)
  was sent directly to the user for local testing/deploy — also not in git.
- **Google Cloud service account key for non-interactive deploy** — asked
  for, never received. Checked this session's environment variables (all
  125 of them) and disk (`~/.config/gcloud/`, `application_default_credentials.json`,
  common key-file name patterns) — nothing found, including the specific
  `GCP_PRIVATE_KEY_JSON` the user referenced. Most likely explanation: it
  was set via environment settings but only takes effect for a *new*
  session in that environment, not one already running.
- **Google Test users list** (the actual server-side allowlist gate —
  OAuth consent screen, Testing status, `ai-labg` project) — **not
  confirmed set up**. This is the real security boundary discussed at
  length; do not treat the client-side `ALLOWLIST` array in
  `firebase-config.js` as sufficient on its own. See
  `examples/voice-notes/REAL-KEYS.md` Part 2.

## Next steps, in order

1. **Confirm the Test users list is actually set up** in Google Cloud
   Console for `ai-labg` (REAL-KEYS.md Part 2) — nothing else here is a
   real access boundary without it.
2. **Complete one real sign-in** — has to happen on a machine with a
   working browser and the owner's real Google account; cannot be done
   from this sandbox. Use the zip bundle already sent, or clone this
   branch and follow REAL-KEYS.md end to end.
3. **If unattended/CI deploy is wanted**: provide a scoped service account
   key (role: Hosting Admin, not Owner) in a *fresh* session — see prior
   conversation for the security tradeoff discussion before doing this.
4. **Open a PR** to `main` when ready — none exists yet for this branch;
   nobody has asked for one.

## Where to read more

- `SPEC.md` — the original spec this implements.
- `docs/framework-api.md` — API reference for building on the framework.
- `examples/voice-notes/REAL-KEYS.md` — full from-scratch Google/Firebase
  project setup, written around the Test-users-list security model.
- `examples/voice-notes/firebase-config.example.js` — template for the
  gitignored real-config file.
