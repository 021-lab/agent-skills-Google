# Task: Voice Notes

Build a voice-controlled notes app on top of the Voice Framework. This is the
acceptance test for the framework itself (see SPEC.md "Acceptance Test —
Voice Notes app").

## Behavior

1. The app shows a single **Record** button.
2. The user presses and holds it and dictates a note. While held, the raw
   audio is captured (`MediaRecorder`).
3. On release:
   - The audio is transcribed (Web Speech API).
   - Gemini reads the transcript and produces a one-line summary — this
     becomes the **file title**.
   - The audio file is written to the user's Google Drive under that title.
   - The transcript is saved to Drive as a text file under the same title.
4. Result: **two titled Drive files** (audio + transcript), both named from
   the AI summary.

## Constraints

- You may only write `index.html` and `app.js` in this directory. All I/O
  (voice, auth, storage, Drive, Gemini) goes through the framework's
  `VoiceApp` API — never call `fetch`, `IndexedDB`, `MediaRecorder`, or
  Google APIs directly from app code.
- The HTML contract is a single `<button data-voice>` — no other markup is
  required for the framework to route input.
- The app registers exactly **one** command handler via `app.handle(...)`.

## Acceptance

Author `TEST.md` from this brief, then implement `index.html` + `app.js`
until the scenarios in `TEST.md` pass via the emulation API
(`app.emulate({ selector: '#record', type: 'say', transcript: '...' })`),
asserting the resulting Drive state.
