#!/bin/sh
set -eu

REPO_DIR="/Users/AIDev/Codex/firebase-voice-framework"

cd "$REPO_DIR"
npm run e2e:auth:upload-secret
