import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveVoiceNotesE2ESiteId,
  resolveVoiceNotesE2EUrl,
} from '../scripts/voice-notes-e2e-config.mjs';

test('resolveVoiceNotesE2ESiteId appends the e2e suffix', () => {
  assert.equal(resolveVoiceNotesE2ESiteId('ai-labg'), 'ai-labg-e2e');
});

test('resolveVoiceNotesE2ESiteId trims long project ids safely', () => {
  assert.equal(
    resolveVoiceNotesE2ESiteId('this-project-id-is-way-too-long-for-a-site'),
    'this-project-id-is-way-too-e2e'
  );
});

test('resolveVoiceNotesE2EUrl prefers an explicit URL override', () => {
  assert.equal(
    resolveVoiceNotesE2EUrl({ projectId: 'ai-labg', url: 'https://custom.example.com/path' }),
    'https://custom.example.com/path'
  );
});

test('resolveVoiceNotesE2EUrl builds the stable Hosting URL from the project id', () => {
  assert.equal(
    resolveVoiceNotesE2EUrl({ projectId: 'ai-labg' }),
    'https://ai-labg-e2e.web.app/examples/voice-notes/index.html'
  );
});
