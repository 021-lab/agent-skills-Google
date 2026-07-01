// Minimal static file server for local dev/E2E testing. Mirrors the one
// header from firebase.json that matters for correctness testing locally:
// Service-Worker-Allowed on /src/pwa/service-worker.js, which lets that
// worker control the whole origin instead of being scoped to /src/pwa/.
// Generic static hosts (`npx serve`, `python3 -m http.server`) don't send
// this, which silently breaks service worker scope in local/CI testing —
// real Firebase Hosting sends it because firebase.json configures it.
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(ROOT, urlPath);

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!existsSync(filePath) || !filePath.startsWith(ROOT)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');

  if (urlPath === '/src/pwa/service-worker.js') {
    res.setHeader('Service-Worker-Allowed', '/');
  }

  createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`dev-server listening on http://127.0.0.1:${PORT}`);
});
