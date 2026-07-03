# GitHub Actions Setup for Firebase Deployment

## Quick Start

### 1. Generate Firebase Token

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Google Account
firebase login

# Generate token for GitHub Actions
firebase login:ci
# Copy the generated token (looks like: 1//0gxxxxxx...)
```

### 2. Add GitHub Secrets

Go to: **GitHub Repo → Settings → Secrets and variables → Actions**

Click **"New repository secret"** and add:

| Secret Name | Value |
|---|---|
| `FIREBASE_TOKEN` | Token from `firebase login:ci` |
| `FIREBASE_PROJECT_ID` | Your Firebase project ID (e.g., `voice-app-123abc`) |

### 3. (Optional) Add GCP Private Key Secret

For advanced authentication needs:

| Secret Name | Value |
|---|---|
| `GCP_PRIVATE_KEY_JSON` | Full JSON from Firebase Console → Service Accounts |

## Workflow Details

The `firebase-deploy-and-test.yml` workflow performs:

### Jobs

1. **validate** - ESLint & Prettier checks
2. **unit-tests** - Run unit tests with `node --test`
3. **build** - Check project structure
4. **firebase-deploy** - Deploy to Firebase Hosting
   - `main` branch → Production
   - `claude/*` branches → Preview (optional)
5. **e2e-tests** - Run Playwright tests against deployed URL
6. **test-plugin-install** - Validate Claude Code plugin

### Triggers

- ✅ Push to `main` (deploy to production)
- ✅ Push to `claude/*` branches (preview deployment)
- ✅ Pull requests to `main` (validate only, no deploy)
- ✅ Manual trigger via GitHub UI (workflow_dispatch)

## Checking Deployment Status

### In GitHub

1. Go to repo → **Actions** tab
2. Click latest **"Firebase Deploy & Test"** run
3. See job status and logs

### In Firebase Console

1. Go to https://console.firebase.google.com
2. Select your project
3. Go to **Hosting** → **Deployments**
4. See deployment history

## Troubleshooting

### Workflow Failed: Missing Secrets

```
Error: FIREBASE_TOKEN is not set
```

**Fix:** Add `FIREBASE_TOKEN` and `FIREBASE_PROJECT_ID` to GitHub Secrets.

### Workflow Failed: Project Not Found

```
Error: Could not find project "undefined"
```

**Fix:** Ensure `FIREBASE_PROJECT_ID` secret is set correctly.

### E2E Tests Timeout

The workflow tries to get Firebase hosting URL after deploy. If tests timeout:

1. Check if Firebase deployment succeeded
2. Verify base URL is correct in GitHub Actions logs
3. Manually test URL in browser

## Local Testing

Before pushing, test locally:

```bash
# Install dependencies
npm ci

# Lint
npm run lint

# Unit tests
npm test

# Build validation
firebase hosting:channel:list

# Serve locally
npm run serve

# E2E tests (in another terminal)
npm run test:e2e
```

## Production vs Preview

### Main Branch → Production

```yaml
firebase deploy \
  --token $FIREBASE_TOKEN \
  --project $FIREBASE_PROJECT_ID
```

Deploys to: `https://your-project.web.app`

### Claude Branches → Preview

```yaml
firebase deploy \
  --token $FIREBASE_TOKEN \
  --project $FIREBASE_PROJECT_ID \
  --only hosting:preview
```

Deploys to preview channel for testing.

**Note:** Preview deployment requires `firebase.json` target configuration.

## Secrets Security

⚠️ **Important:**

- `FIREBASE_TOKEN` grants full access to your Firebase account
- Never commit secrets to Git
- Use `.env.example` for documentation only
- Rotate token if compromised: `firebase login:ci` (get new one)

## Environment Variables

The workflow sets:

```bash
NODE_VERSION=20
FIREBASE_TOKEN=(from secrets)
FIREBASE_PROJECT_ID=(from secrets)
BASE_URL=(auto-detected from Firebase)
```

Apps can access these in Node.js environment during deploy.

For browser runtime variables, use `window` globals or hardcoded values.

## Advanced: Custom Deployment Targets

To deploy to different Firebase hosting targets (production, staging, preview):

Update `firebase.json`:

```json
{
  "hosting": [
    {
      "target": "production",
      "public": "src",
      "rewrites": [{"source": "**", "destination": "/index.html"}]
    },
    {
      "target": "staging",
      "public": "src"
    }
  ]
}
```

Update `.firebaserc`:

```json
{
  "projects": {
    "default": "your-firebase-project-id"
  },
  "targets": {
    "your-firebase-project-id": {
      "hosting": {
        "production": ["voice-app"],
        "staging": ["voice-app-staging"]
      }
    }
  }
}
```

Update workflow to deploy specific target:

```yaml
firebase deploy --only hosting:production
```

## Next Steps

1. ✅ Generate Firebase token
2. ✅ Add GitHub Secrets
3. ✅ Push to `main` branch
4. ✅ Watch GitHub Actions
5. ✅ Verify deployment in Firebase Console
6. ✅ Test deployed URL
