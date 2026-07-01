# Voice Framework API Reference

Coder/agent-facing reference for the framework described in `SPEC.md`. If
you're building an app on top of this framework, this is the API surface
you're allowed to touch — everything else (voice, auth, storage, Drive,
Gemini) lives inside the framework and must never be called directly.

## Quick start

```html
<!-- The entire HTML contract: mark interactive elements, nothing else. -->
<button id="record" data-voice>Record</button>
```

```js
import { VoiceApp } from "/src/voiceframe.js";

const app = await VoiceApp.init({
  firebase,        // Firebase app/auth instance
  allowlist,        // string[] of allowed emails, lowercase
  googleClientId,   // Google Identity Services client id
  geminiClient,     // { generate({model, prompt}) -> {text} }
  driveClient,      // Drive REST-like client (see drive.js)
  appId: "my-app",  // scopes this app's Drive folder and Firestore paths
});

// ONE handler receives every input — tap AND say, user AND agent.
app.handle(async (ctx) => {
  if (ctx.type === "say" && ctx.transcript) {
    const title = await app.summarize(ctx.transcript);
    await ctx.drive.upload({ name: `${title}.txt`, blob: { data: ctx.transcript }, mimeType: "text/plain" });
    ctx.log({ title });
  }
});
```

## `VoiceApp.init(config)`

Initializes the framework and returns a `VoiceApp` instance. All config
keys are optional; omitting a capability's config disables that capability
rather than erroring (e.g. no `firebase`/`allowlist` means no auth gate, no
`geminiClient` means `interpret()`/`summarize()` throw if called).

| Key | Type | Effect |
|---|---|---|
| `firebase` | `{ auth }` | Enables Google auth. Both `firebase` and `allowlist` are required together. |
| `allowlist` | `string[]` | Emails permitted to sign in (case-insensitive). An empty allowlist rejects everyone. |
| `googleClientId` | `string` | Passed through to Google Identity Services. |
| `idb` | `IDBFactory` | Overrides the `indexedDB` global (mainly for tests). |
| `firestore` | Firestore-like client | Enables per-user cloud sync once a user signs in. |
| `driveClient` | Drive-like client | Enables `ctx.drive`. |
| `geminiClient` | `{ generate }` | Enables `ctx.interpret()` / `app.summarize()`. |
| `geminiModel` | `string` | Model id passed to `geminiClient.generate()`. Default `gemini-1.5-flash`. |
| `appId` | `string` | Scopes the Drive folder (`VoiceFramework/<appId>/...`) and Firestore collection paths. |
| `captureAudio` | `boolean` | When `true`, `"say"` commands also capture a `MediaRecorder` blob into `ctx.audioBlob`. |
| `ui` | `boolean` | Default `true`. Set `false` to skip mounting the injected chrome (Undo/Log/mic). |
| `pwa` | `boolean` | Default `true`. Set `false` to skip service worker registration. |
| `debug` | `boolean` | Exposes `window.__voiceframe.emulate` for local/manual driving. |

## The app handler contract

```js
app.handle(async (ctx) => { ... });
```

Exactly one handler may be registered. It receives every command — taps,
holds-and-speaks, and agent-emulated commands — through the same `ctx`
shape:

| Field | Type | Notes |
|---|---|---|
| `ctx.element` | `Element` | The element that was pressed (carries its `data-voice-*` attributes). |
| `ctx.type` | `"tap" \| "say"` | Short press vs. press-and-hold-and-speak. |
| `ctx.transcript` | `string \| null` | Populated for `"say"` once Web Speech resolves (or immediately, if supplied via `emulate()`). |
| `ctx.audioBlob` | `Blob \| null` | Populated for `"say"` only when `captureAudio: true`. |
| `ctx.db` | tracked DB API | See below. `null` if IndexedDB isn't available. |
| `ctx.drive` | Drive API | See below. `null` until a user is signed in (when auth is configured) or if no `driveClient` was supplied. |
| `ctx.interpret(schema)` | `(schema) => Promise<object>` | Gemini-parsed structured intent from `ctx.transcript`. Throws if no `geminiClient` configured. |
| `ctx.log(detail)` | `(detail) => Promise<entry>` | Attaches structured detail to this command's log entry. |

### `ctx.db` — tracked local storage

A thin wrapper around `LocalDB` (see `src/core/db.js`) where every
`put`/`delete` automatically pushes its inverse onto the undo stack — you
never manage undo yourself.

```js
await ctx.db.put("mutations", { id: "item-1", text: "buy milk" });
const record = await ctx.db.get("mutations", "item-1");
const all = await ctx.db.getAll("mutations");
await ctx.db.delete("mutations", "item-1");
```

Built-in store names: `mutations`, `metadata`, `outbox`, `log`, `fixtures`.
App code should generally only touch `mutations`.

### `ctx.drive` — Google Drive file I/O

```js
const { id, name } = await ctx.drive.upload({ name: "note.txt", blob, mimeType: "text/plain" });
const { data, mimeType } = await ctx.drive.download(id);
const files = await ctx.drive.list();
await ctx.drive.delete(id);
```

Files are scoped under `VoiceFramework/<appId>/` in the signed-in user's
Drive — apps sharing a Google account don't collide.

### `ctx.interpret(schema)` / `app.summarize(text)`

```js
const intent = await ctx.interpret(ctx.transcript, {
  type: "object",
  properties: { action: { type: "string" }, item: { type: "string" } },
  required: ["action", "item"],
});

const title = await app.summarize(longText); // one-line summary
```

`interpret()` validates the model's JSON response against the schema
(required fields + primitive type checks) and throws if it doesn't match —
callers don't need to re-validate.

## `app.emulate(command)` — agent-emulation API

Drives the page programmatically through the *exact same* dispatch path as
a real tap/hold — the same context wiring, the same handler, the same
logging. Used by tests and by an agent replaying a corrected fixture.

```js
const result = await app.emulate({
  selector: "#record",       // required: CSS selector for the target element
  type: "say",                // "tap" | "say", default "say"
  transcript: "buy milk",     // required for meaningful "say" commands
  audioBlob: null,             // optional, mimics MediaRecorder output
});
// result: { success: true, context: ctx }
```

In debug mode (`config.debug: true`), the same function is reachable at
`window.__voiceframe.emulate(...)` — usable from a local console or an
agent's networked sandbox driving the deployed URL.

## Undo

```js
app.undoStack.canUndo();      // boolean
app.undoStack.depth();        // number of pending undo actions
await app.undoStack.undo();   // reverses the most recent mutation
await app.undoStack.undoN(3); // reverses up to 3, LIFO
```

Every `ctx.db.put`/`ctx.db.delete` call made inside the handler
automatically pushes an inverse here — app code never calls `undoStack.push()`
directly.

## Command log & voice-correction fixtures

```js
app.commandLog.getEntries();               // every command, most-recent-last
app.commandLog.getEntry(id);

// Voice correction -> replayable fixture:
const fixture = await app.commandLog.correct(entryId, {
  transcript: "corrected transcript",
  expected: { /* whatever the app asserts on replay */ },
});
// fixture: { id, logId, selector, type, transcript, expected, createdAt }
```

Fixtures round-trip through `JSON.stringify`/`JSON.parse` — persist them as
`issues/NNNN-*.fixture.json` and replay with `app.emulate(fixture)` to
reproduce and verify a fix (see SPEC.md "The correction loop, mapped onto
the tree").

## Auth

```js
app.auth.isSignedIn();   // boolean
app.auth.getUser();      // current Firebase user, or null
app.auth.getState();     // "signed-out" | "signing-in" | "signed-in" | "rejected"
await app.auth.signIn(googleCredential);
await app.auth.signOut();
app.auth.onChange(({ state, user }) => { ... });
```

`app.auth` is `null` when `firebase`/`allowlist` weren't supplied to
`init()`. When configured, every dispatched command (live or emulated)
calls `auth.requireAuth()` first — commands from unauthenticated or
non-allowlisted users never reach the app handler.

## UI chrome

Mounted automatically (`config.ui !== false`): an Undo button, a Log tab
listing command history, and a mic/recording indicator. No app code is
required to use it; `app.ui` exposes the same instance if you need to
inspect its state (mainly useful in tests):

```js
app.ui.setMicState("listening"); // idle | listening | recording
```

## What you must never do in app code

- Call `fetch`, `IndexedDB`, `MediaRecorder`, or any Google/Firebase SDK
  directly — always go through `ctx`/`app`.
- Push to `app.undoStack` manually — `ctx.db` does this for you.
- Register more than one handler via `app.handle()`.
- Modify anything under the platform submodule (`platform/framework`,
  `platform/skills`) — see SPEC.md "Repository Topology & Layer
  Segregation".
