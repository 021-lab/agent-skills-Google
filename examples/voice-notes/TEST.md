# Test: Voice Notes acceptance criteria

Authored from TASK.md. Exercised via the emulation API
(`app.emulate({ selector: '#record', type: 'say', transcript })`) and
asserted against the resulting Drive state — see
`tests/voice-notes.e2e.spec.js`.

## Scenario 1: Recording a note creates two titled Drive files

**Given** the app is loaded and the user is authenticated
**When** the user presses and holds `#record`, dictates
"Remember to buy milk and eggs from the store tomorrow morning", and
releases
**Then**:
- An audio file is written to Drive.
- A transcript text file is written to Drive.
- Both files share the same title, derived from a one-line Gemini summary
  of the transcript (e.g. "Buy milk and eggs").
- The transcript file's contents equal the dictated transcript.

## Scenario 2: Each recording produces its own pair of files

**Given** the app is loaded and the user is authenticated
**When** the user records two separate notes in sequence
**Then** Drive contains two audio files and two transcript files (four
files total), each pair titled independently from its own summary.

## Scenario 3: The command is logged and undoable

**Given** the app is loaded and the user is authenticated
**When** the user records a note
**Then**:
- The command appears in the command log with its transcript.
- Pressing Undo removes the note's local record (and, in a real deploy,
  reverses the Drive/Firestore writes made for it).

## Non-goals for this test

- Real device audio capture / Web Speech accuracy — mocked via the
  emulation API's `transcript` parameter, matching how the framework's own
  E2E suite mocks Web Speech (see SPEC.md "Testing Strategy").
- Visual/timing/gesture behavior — out of scope for `emulate()`-driven tests
  (see SPEC.md "Target Platform & Limitations").
