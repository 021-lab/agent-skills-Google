#!/bin/sh
set -eu

REPO_DIR="/Users/AIDev/Codex/firebase-voice-framework"

PROJECT_ID="${1:-${FIREBASE_PROJECT_ID:-}}"
if [ -z "$PROJECT_ID" ]; then
  echo "Usage: FIREBASE_PROJECT_ID=<project-id> $0"
  echo "   or: $0 <project-id>"
  exit 1
fi

cd "$REPO_DIR"
FIREBASE_PROJECT_ID="$PROJECT_ID" npm run e2e:auth:save
