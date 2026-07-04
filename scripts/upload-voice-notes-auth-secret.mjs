import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const statePath = resolve(process.env.E2E_STORAGE_STATE_PATH || 'playwright/.auth/voice-notes-google.json');
const secretValue = readFileSync(statePath).toString('base64');

execFileSync('gh', ['secret', 'set', 'E2E_PLAYWRIGHT_STORAGE_STATE_B64', '--body', secretValue], {
  stdio: 'inherit',
});

console.log(`Uploaded ${statePath} to GitHub secret E2E_PLAYWRIGHT_STORAGE_STATE_B64`);
