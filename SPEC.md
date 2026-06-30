# Spec: Voice Web Application Framework («Фреймворк голосового веб-приложения»)

> Status: **Draft for review.** This document specifies the framework and its first
> acceptance test. No framework or application code is written yet — implementation
> follows via `/plan` and `/build` after this spec is approved.

## Objective

### What we are building

A **framework that turns any static HTML page into a voice-controlled application**, where
the user supervises the page by voice and a coding **agent** builds the application on top of
an *immutable* framework.

The voice UX is real, but it is not the headline. The real purpose is an **agent-build
harness**: a tightly-constrained substrate where a coding agent ships a small, *verifiable*
app without reinventing — or escaping — the framework's I/O, and where the human's voice is
the in-the-loop channel for **driving, observing, and correcting** what the agent built.

The load-bearing parts of the framework are therefore:

1. **A single input dispatcher** — every user action (tap or speak) and every agent action
   flows through one code path, contextual to the element that was pressed.
2. **The agent-emulation API** — an agent can drive the page programmatically (locally or over
   the network against the deployed URL) and observe the resulting database state.
3. **The command log → replayable-fixture correction loop** — every command is logged; a
   mis-handled command can be voice-corrected, and that correction serializes into a
   structured, replayable **test fixture** the agent consumes to fix the app and prove the fix.
4. **Stack-based Undo** — any number of actions can be reversed.
5. **The framework↔app repository boundary** — the app repo depends on the framework repo as
   an immutable external dependency and may only add app code.

### Who it is for

- **Primary:** the coding agent building an app under supervision, and the human supervising
  and correcting it by voice.
- **Downstream:** end-users who control the resulting apps hands-free on mobile.

### Why now

We want a substrate where AI coding agents reliably ship small *verifiable* apps without
hand-rolling input, auth, storage, or sync — with a built-in human-in-the-loop
**correction → regression-test** loop so mistakes become durable, replayable tests rather
than one-off fixes.

### User stories (reframed as testable acceptance criteria)

The brief's original task-list examples are illustrations only; the framework itself is
domain-agnostic. Reframed as criteria the framework must satisfy:

- **Contextual command.** Given a user presses-and-holds element *E* and speaks transcript *T*,
  the framework dispatches exactly one command `{element: E, type: "say", transcript: T}` to the
  app's single handler, and the command appears in the log.
- **Tap action.** Given a user taps element *E* (short press, no speech), the framework
  dispatches `{element: E, type: "tap"}` to the same handler.
- **Dynamic elements.** Given the app's JS adds a `[data-voice]` element *after* load in
  response to a user action, that element is voice-active without any extra wiring by the app.
- **Undo.** Given N mutating commands have run, pressing Undo N times reverses them in
  LIFO order, restoring prior state.
- **Voice correction → fixture.** Given a logged command was mis-handled, the user opens the
  log, selects it, and speaks a correction; the framework persists a structured fixture
  `{selector, type, transcript, expected}`.
- **Agent replay.** Given a fixture, an agent calls the emulation API to reproduce the command
  (against a local or deployed URL), and can assert the resulting Firestore/Drive state.

### Success criteria

This framework is "done" (v1) when an agent, given a task and the immutable framework, ships a
plain HTML+JS app; a human drives it by voice; a mis-handled command voice-corrected in the log
becomes a fixture; the agent replays the fixture via the emulation API, fixes the app code, and
the fixture passes. The **Voice Notes** app (below) is the first such proof.

### Out of scope (for v1 / this spec)

- A **true runtime sandbox** of app code (see Containment, below — v1 uses convention + CSP +
  verification, not a runtime jail).
- The **local↔cloud sync conflict-resolution algorithm** beyond a v1 default (see Open Questions).
- Multi-user / real-time collaboration.
- Non-Google authentication.

## Tech Stack

All choices stay within the Google free tier and require **no build step**.

| Concern | Choice | Notes |
|---|---|---|
| Language / packaging | Vanilla **ES modules**, no bundler | Output is plain HTML + JS; library loaded via `<script type="module">`. |
| Live transcription | **Web Speech API** (`SpeechRecognition`) | Browser/cloud-backed; used for command transcripts. |
| Raw audio capture | **`MediaRecorder`** | Runs in parallel when an app needs the audio blob (e.g. Voice Notes). |
| Auth | **Google Identity Services** / **Firebase Auth** | Google login is mandatory. |
| Local DB | **IndexedDB** | Source of truth on-device. |
| Cloud sync | **Cloud Firestore** | Mirrors the local DB for backup + cross-device. |
| File blobs | **Google Drive API** | Audio, transcripts, large files. |
| AI | **Gemini** via **Firebase AI Logic** | Command interpretation + one-line summaries (free tier). |
| Install modes | **PWA** (`manifest.webmanifest` + service worker) **and** plain page | Either installed to home screen or loaded in a browser. |
| Hosting / deploy | **Firebase Hosting** | `firebase deploy`. |
| Network containment | **Content-Security-Policy** | `connect-src` limited to Google/Firebase endpoints. |
| Process governance | **agent-skills, vendored** | Skills live in the immutable platform repo (not a marketplace plugin); discovered via `CLAUDE.md`/`AGENTS.md` + project-scoped `.claude/settings.json`. See [Repository Topology](#repository-topology--layer-segregation). |

Pin versions where they matter at implementation time (Firebase JS SDK, Google Identity
Services); record the chosen Gemini model id in this spec once confirmed (see Open Questions).

## Commands

This is a static project — there is no compile/build step.

```
Dev / serve:   npx serve .            # or: python3 -m http.server 8080
Unit tests:    node --test            # node:test runner
E2E tests:     npx playwright test    # targets a local OR deployed URL
Deploy:        firebase deploy        # Firebase Hosting
Lint:          npx eslint src
Format:        npx prettier --write .
```

## Project Structure

The framework lives in **its own repository** (apps depend on it as an immutable external
dependency). This spec describes that repository's intended layout:

```
src/voiceframe.js          Public API entry (ES module): VoiceApp.init / handle / emulate
src/core/dispatcher.js     Tap-vs-hold detection; the single input handler. Uses event
                           delegation + a MutationObserver so dynamically-created
                           [data-voice] elements auto-wire with no app-side code.
src/core/voice.js          Web Speech API transcription + MediaRecorder audio capture
src/core/auth.js           Google login (mandatory)
src/core/db.js             IndexedDB local store
src/core/sync.js           Firestore <-> local reconciliation
src/core/drive.js          Google Drive file I/O
src/core/ai.js             Gemini: interpret(transcript, schema) + summarize(text)
src/core/undo.js           Action/inverse stack
src/core/log.js            Command log + voice-correction -> structured replayable fixture
src/core/emulate.js        Agent-emulation API (local + over-network against deployed URL)
src/core/ui.js             Injected chrome: Undo button, Log tab, mic/recording indicator
src/pwa/manifest.webmanifest
src/pwa/service-worker.js
firebase.json              Firebase Hosting + CSP config
examples/voice-notes/      Acceptance-test app (see below)
  index.html
  app.js
  TASK.md                  The task brief given to the coder/agent
  TEST.md                  The acceptance test the coder/agent authors from TASK.md
docs/framework-api.md      Coder/agent-facing API reference
tests/                     Unit (node:test) + E2E (Playwright) for the framework itself
```

The framework is **bundled with the agent-skills into one immutable "platform" repo** and consumed
by each app through a pinned submodule — see [Repository Topology & Layer Segregation](#repository-topology--layer-segregation).
The `examples/voice-notes/` app above is illustrative; a *real* app lives in its own project repo
per that topology.

## Code Style

Vanilla ES modules, no transpilation, modern browser targets only. The coder/agent writes
**only** HTML with marked elements plus one command handler — never any I/O.

```html
<!-- The coder marks interactive elements; that is the entire HTML contract. -->
<button data-voice data-voice-context="search">Search</button>
<li data-voice data-voice-id="item-42">Buy milk</li>
<!-- Elements the app's JS creates later are auto-wired the same way. -->
```

```js
import { VoiceApp } from "https://cdn.example/voiceframe.js";

const app = await VoiceApp.init({ googleClientId, firebase, gemini, schema });

// ONE handler receives every input — tap AND say, user AND agent.
app.handle(async (ctx) => {
  // ctx.element     the pressed element (carries its data-voice-* context)
  // ctx.type        "tap" | "say"
  // ctx.transcript  string, for "say"
  // ctx.audioBlob   Blob | null, when the app requested raw audio
  // ctx.interpret(intentSchema)  -> Gemini-parsed structured intent
  // ctx.db          local DB API; mutations auto-record on the undo stack
  // ctx.drive       Google Drive file I/O
  // ctx.log(detail) attach structured detail to this command's log entry
});
```

The agent hook is a first-class method, not a side door:

```js
// Drive the page programmatically; reachable on window.__voiceframe in debug mode,
// and over the network against the deployed URL.
await app.emulate({ selector: '[data-voice-id="item-42"]', type: "say",
                    transcript: "mark this done" });
```

Conventions: `camelCase` for functions/variables, one module per `core/` concern, no global
state outside the `VoiceApp` instance, all async via `async/await`, no app-visible network or
storage calls outside the framework API.

## Testing Strategy

**Unit (`node:test`)** — pure logic with no browser: dispatcher tap-vs-hold thresholds, undo
inverse application, IndexedDB op shapes, Gemini prompt building, and **fixture serialization**
(`{selector, type, transcript, expected}` round-trips).

**The correction loop is the heart of testing.** A log entry plus a voice correction serializes
into a structured, replayable fixture. Fixtures are the regression suite: each corrected command
becomes a permanent test.

**E2E (Playwright)** — drives the app *through the emulation API* (Web Speech mocked):

- In CI, against a **local** URL.
- From the agent's networked sandbox, against the **deployed Firebase Hosting URL**.

Each E2E assertion drives a command via `app.emulate(...)` and verifies the resulting
**Firestore / Drive** state. The Voice Notes example must pass its `TEST.md` scenarios this way.

## Boundaries

- **Always:**
  - Keep all I/O inside the framework library.
  - Require Google authentication before any data access.
  - Log every command (user *and* agent).
  - Push every mutation onto the undo stack.
  - Route every input — including dynamically-created elements — through the single dispatcher.
  - Serialize voice corrections as replayable fixtures.
- **Ask first:**
  - Firestore schema or security-rule changes.
  - Adding any dependency.
  - Changing the Gemini model.
  - Expanding OAuth scopes.
  - Changing Hosting / deploy configuration.
- **Never:**
  - Commit secrets or API keys.
  - Perform local (offline) transcription.
  - Let app code bypass the dispatcher or perform its own I/O.
  - Let the app repository modify the immutable platform submodule (framework **or** skills).
  - Write outside the project's writable allowlist (`app/**`, `tests/**`, `issues/*`, `TEST.md`) —
    see [Repository Topology](#repository-topology--layer-segregation).

### Containment model

Containment is **strong convention + CSP + verification**, not a runtime jail. A single
same-origin ES module cannot technically stop app JS from calling `fetch`; v1 enforces the
boundary by (a) providing all I/O through the framework API, (b) a `connect-src` CSP that limits
reachable network endpoints to Google/Firebase, and (c) the emulation/log/test harness proving
behavior under review. A true runtime sandbox (Worker/iframe + capability message-passing) is a
possible future hardening, explicitly out of scope for v1.

## Acceptance Test — Voice Notes app (the «тестовое задание»)

The first app built on the framework, used to prove the harness works end-to-end.

**Behavior:**

1. The app shows a single **Record** button.
2. The user presses and holds it and dictates a note (`MediaRecorder` captures audio).
3. On release, the audio file is written to the user's **Google Drive**.
4. A transcription module transcribes the recording.
5. **Gemini** reads the transcript and produces a one-line summary used as the **file title**.
6. The transcript is saved to Drive as a text file under that title; the audio file is titled to
   match.
7. Result: **two titled Drive files** (audio + transcript), both named from the AI summary.

**Test setup (how the harness is exercised):**

- A **separate app repository** references the framework repository as an **immutable external
  dependency** (git submodule or a pinned import URL). The coder/agent may only add app code.
- The coder/agent receives `TASK.md` in its repo and authors `TEST.md` from it.
- The app is **deployed to Firebase Hosting**.
- From its **networked sandbox**, the agent drives the deployed UI via the emulation API
  (`app.emulate({ selector: "#record", type: "say", transcript: "..." })`) and asserts that the
  two correctly-titled files exist in Drive.

## Repository Topology & Layer Segregation

The system separates four concerns into a **constraint hierarchy** where each layer constrains the
one below, and the **project repo is the only writable surface**. Immutability is *structural* —
the framework and the agent-skills live in one read-only submodule the agent cannot edit — not a
convention the agent is trusted to honor. The layout exists to **prioritize project development
while keeping it constrained by the framework**.

```
IMMUTABLE PLATFORM REPO            own repo · vendored into each project as a pinned submodule
   voice-platform/
   ├── framework/                  the coding surface apps import (the SPEC §Project Structure tree)
   │   ├── voiceframe.js
   │   ├── core/{dispatcher,voice,auth,db,sync,drive,ai,undo,log,emulate,ui}.js
   │   └── pwa/{manifest.webmanifest,service-worker.js}
   ├── skills/                     vendored agent-skills (immutable copy): spec · plan · build ·
   │                               review · ship … (one SKILL.md each)
   ├── commands/                   slash-command wrappers (/spec, /build, …)
   ├── AGENTS.md                   RULES OF APPLICATION — when/how to use each skill + the
   │                               immutability & writable-surface contract (read-only)
   └── docs/framework-api.md

PROJECT REPO                       writable · the working tree   ← center of gravity
   voice-notes/                    (one repo per app)
   ├── platform/                   → submodule → voice-platform   [READ-ONLY, pinned commit]
   │                                 carries BOTH framework AND skills
   ├── app/                        ← the ONLY code the agent writes
   │   ├── index.html              marks [data-voice] elements (the HTML contract)
   │   └── app.js                  the single command handler (app.handle)
   ├── issues/                     user-voice corrections
   │   ├── 0001-search-misheard.fixture.json   {selector,type,transcript,expected}
   │   └── 0001-search-misheard.md             human-readable context + status
   ├── tests/                      generated from issues/, replayed via the emulation API
   │   └── 0001-search-misheard.spec.js
   ├── CLAUDE.md                   discovery entrypoint (auto-read by Claude Code): points to
   │                               platform/skills/ + platform/AGENTS.md; states the allowlist
   ├── AGENTS.md                   same pointer, cross-agent convention (any agent reads this)
   ├── .claude/settings.json       registers platform/skills + platform/commands as PROJECT-scoped
   │                               (native /spec, /build … with NO global plugin install)
   ├── TASK.md                     [READ-ONLY] the brief given to the agent
   ├── TEST.md                     acceptance test authored once from TASK.md
   ├── firebase.json               Firebase Hosting + CSP (deploy)
   └── .gitmodules                 pins the platform submodule commit
```

### How an agent discovers the skills + rules from repo access (no plugin install)

1. The agent is granted the **project repo** and runs `git clone --recurse-submodules`, pulling
   `platform/` (framework **and** skills) immutably.
2. On open it auto-reads the project-root **`CLAUDE.md`** (Claude Code) / **`AGENTS.md`** (the
   cross-tool standard). These point into `platform/skills/` and `platform/AGENTS.md`.
3. Skills are plain `SKILL.md` files in the read-only submodule, usable as instructions by any
   agent; `.claude/settings.json` additionally wires them for native slash-command invocation.
4. The rules of application and the immutability/writable contract live in the **immutable**
   `platform/AGENTS.md`, so the agent learns them on access but **cannot weaken its own rules**.

No marketplace, no install step, no global plugin state — portable to any agent that honors
`AGENTS.md`.

### Enforcement (structural, not just trust)

- `platform/` is a pinned submodule; a pre-commit hook + CI job reject any diff under `platform/`
  originating in the project repo → framework **and** skills are immutable to the app.
- **Writable allowlist** = `app/**`, `tests/**`, `issues/*` (status/resolution), `TEST.md`.
  Everything else (`platform/`, `TASK.md`, the discovery files) is read-only and CI-guarded.
- **Dependency direction is one-way:** `project/app → platform/framework` (import) → ∅. Skills
  govern from the read-only submodule; issues feed *into* the project.

### The correction loop, mapped onto the tree

1. The user voice-corrects a logged command → the framework serializes a fixture.
2. The fixture lands in `issues/NNNN-*.fixture.json` (+ `.md` context).
3. `/build` + `/review` (from `platform/skills`) read the issue → generate `tests/NNNN-*.spec.js`
   that replays it via `app.emulate(...)` against the deployed Firebase URL → the test fails.
4. The agent edits `app/**` only → the test passes → the commit references the issue → status
   becomes resolved. Each correction thus becomes a permanent regression test.

## Open Questions

1. **Sync conflict-resolution policy.** The brief leaves local↔cloud reconciliation
   under-specified (last-write-wins vs. merge vs. prompt-the-user). **Proposed v1 default:**
   last-write-wins by record timestamp, with the command log as the audit trail. Flagged for a
   follow-up decision before the sync module is built.
2. **Gemini model id / quota.** Confirm the exact free-tier model identifier and rate limits;
   record here once chosen.
3. **Drive folder layout.** Where app data and per-app file collections live in the user's Drive
   (single app folder vs. per-app subfolders).
```
