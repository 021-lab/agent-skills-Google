// SPEC.md calls for the WebKit engine to match iOS Safari. This sandbox only
// has Chromium provisioned (no network fetch of WebKit binaries), so E2E runs
// here substitute Chromium; a real CI/dev environment should switch the
// `use` block below to `devices['iPhone 14']` / the `webkit` browserName once
// WebKit is installed, plus the real-device iPhone smoke check SPEC.md calls for.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.spec.js',
  timeout: 30000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    },
  },
  webServer: {
    // Health-checked by TCP port, not a URL: the repo root has no index.html
    // (apps live under examples/ or tests/fixtures/), so a path-based check
    // would 404 forever even though the server is up.
    command: 'node scripts/dev-server.mjs 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
