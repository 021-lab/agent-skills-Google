# Firebase Setup & Deployment Guide

## Overview

This project deploys to **Firebase Hosting** with automated CI/CD via GitHub Actions. The deployment workflow:

1. **Validates** code (ESLint, Prettier)
2. **Tests** with Node.js unit tests and Playwright E2E tests
3. **Builds** and checks structure
4. **Deploys** to Firebase Hosting
5. **Runs E2E tests** against deployed URL

## Prerequisites

### 1. Create Firebase Project

```bash
# Go to Firebase Console: https://console.firebase.google.com
# Create a new project (or use existing one)
# Note your project ID: your-firebase-project-id
```

### 2. Get Firebase Token (FIREBASE_TOKEN)

Run this locally to generate a Firebase token:

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase (opens browser)
firebase login

# Get your token for GitHub Actions
firebase login:ci
# This outputs a token like: 1//0g...rest_of_token
```

**Important:** This token has full access to your Firebase account. Keep it secret!

### 3. Get GCP Private Key (Optional - for advanced auth)

If you need service account credentials (not required for basic Firebase Hosting):

```bash
# In Firebase Console:
# 1. Go to Project Settings → Service Accounts
# 2. Click "Generate new private key"
# 3. Download the JSON file
# 4. Copy the entire JSON content
```

The file contains:
```json
{
  "type": "service_account",
  "project_id": "your-firebase-project-id",
  "private_key_id": "key_id",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxx@appspot.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/certificates..."
}
```

## GitHub Actions Secrets Setup

### Required Secrets

1. **FIREBASE_TOKEN** (Required)
   - Value: Output from `firebase login:ci`
   - Scope: Repository secrets

2. **FIREBASE_PROJECT_ID** (Required)
   - Value: Your Firebase project ID (e.g., `voice-app-123abc`)
   - Scope: Repository secrets

### Optional Secrets

3. **GCP_PRIVATE_KEY_JSON** (Optional)
   - Value: Full JSON from service account key
   - Use only if you need service account authentication
   - Scope: Repository secrets

### How to Add Secrets to GitHub

1. Go to GitHub repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add each secret:

```
Name: FIREBASE_TOKEN
Value: 1//0gxxxxxx...
```

```
Name: FIREBASE_PROJECT_ID
Value: your-firebase-project-id
```

## Workflow Triggers

The `firebase-deploy-and-test.yml` workflow:

- ✅ Runs on **push to `main`** → deploys to production
- ✅ Runs on **push to `claude/**` branches** → preview deployments
- ✅ Runs on **pull requests** → validation only (no deploy)
- ✅ Runs on **manual trigger** (workflow_dispatch)

## Deployment Preview Channels

For `claude/*` branches, the workflow attempts to deploy to a preview channel:

```yaml
firebase deploy --only hosting:preview
```

This requires your `firebase.json` to define a `preview` target:

```json
{
  "hosting": [
    {
      "target": "production",
      "public": "src"
    },
    {
      "target": "preview",
      "public": "src"
    }
  ]
}
```

## Local Testing & Deployment

### Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### Serve Locally

```bash
npm run dev
# or
npm run serve
```

### Run Tests Locally

```bash
# Unit tests
npm test

# E2E tests (requires running server)
npm run test:e2e

# Lint
npm run lint
```

### Deploy Manually

```bash
# To production (main branch equivalent)
npm run deploy

# To preview channel
npm run deploy:preview
```

## Troubleshooting

### "FIREBASE_TOKEN is missing"

```
❌ Error: FIREBASE_TOKEN environment variable is not set
```

**Solution:** Add `FIREBASE_TOKEN` to GitHub repo secrets.

### "Project not found"

```
❌ Error: Could not find project "undefined"
```

**Solution:** 
1. Set `FIREBASE_PROJECT_ID` secret
2. Ensure Firebase project exists: https://console.firebase.google.com

### "Permission denied"

```
❌ Error: Permission denied on Firebase project
```

**Solution:**
- Verify `FIREBASE_TOKEN` is valid: `firebase login:ci` (get new token)
- Check Firebase project role assignment (should be "Editor" or higher)

### "Playwright tests fail after deploy"

The E2E test job needs:
1. `playwright.config.js` in repo root
2. Test files in `tests/` or `e2e/` directory
3. Tests should use `process.env.BASE_URL` if deploying

Example `playwright.config.js`:

```js
export default {
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run serve',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
  },
}
```

## Environment Variables in Firebase

To pass environment variables to your Firebase-hosted app:

1. Create `.firebaserc` with custom variables (not recommended for secrets)
2. Or use Firebase Functions (if deployed)
3. Or hardcode after build (for public vars only)

## Security Considerations

⚠️ **Never commit these to Git:**
- `.env` files with real credentials
- Service account private keys
- `FIREBASE_TOKEN` values

✅ **Always use GitHub Secrets** for sensitive values

✅ **Use `.env.example`** to document what variables are needed

## Monitoring Deployments

### View Deployment Logs

```bash
# List recent deployments
firebase hosting:list

# Get deployment details
firebase hosting:channels:list
```

### Monitor in Firebase Console

1. Go to Firebase Console → Hosting
2. Click "Deployments" tab
3. See deployment history and logs

## Next Steps

1. ✅ Create Firebase project
2. ✅ Get `FIREBASE_TOKEN` via `firebase login:ci`
3. ✅ Add secrets to GitHub
4. ✅ Push to main or claude/* branch
5. ✅ Watch workflow in GitHub Actions
6. ✅ View deployed app at Firebase Hosting URL

## Additional Resources

- [Firebase Hosting Docs](https://firebase.google.com/docs/hosting)
- [Firebase CLI Reference](https://firebase.google.com/docs/cli)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
