// google-sdk.js: framework-owned adapters that wire real Google/Firebase
// SDKs into the shapes auth.js / ai.js / drive.js already expect (see
// docs/framework-api.md). App code never imports the real Firebase/Google
// SDKs directly — SPEC.md: "Never: Let app code bypass the dispatcher or
// perform its own I/O." A deploy's bootstrap script (not app.js) constructs
// these adapters from raw config and passes them into VoiceApp.init().
//
// NOTE ON VERIFICATION: the exact Firebase CDN paths/version below have not
// been confirmed against a live network fetch in this environment. Verify
// against https://firebase.google.com/docs/web/setup before relying on this
// in production, and update FIREBASE_SDK_VERSION accordingly.

const FIREBASE_SDK_VERSION = '10.14.1';
const FIREBASE_CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

// Drive scope requested alongside Firebase sign-in so one popup grants both
// the Firebase user (for the allowlist check in auth.js) and a Google OAuth
// access token usable for Drive API calls — no separate Google Identity
// Services flow needed.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

async function defaultLoadFirebaseAuth() {
  const [appMod, authMod] = await Promise.all([
    import(/* @vite-ignore */ `${FIREBASE_CDN}/firebase-app.js`),
    import(/* @vite-ignore */ `${FIREBASE_CDN}/firebase-auth.js`),
  ]);
  return { ...appMod, ...authMod };
}

async function defaultLoadFirebaseAI() {
  return import(/* @vite-ignore */ `${FIREBASE_CDN}/firebase-ai.js`);
}

// Real Firebase Auth adapter, shaped to match what auth.js's Auth class
// already expects: { onAuthStateChanged, signInWithCredential, signOut }.
// Also exposes signInWithGooglePopup() + getAccessToken(), which are
// framework-specific extensions auth.js calls through a passthrough method.
export async function createFirebaseAdapter(firebaseConfig, { _loadFirebaseAuth } = {}) {
  if (!firebaseConfig) {
    throw new Error('createFirebaseAdapter() requires a firebaseConfig object');
  }

  const sdk = await (_loadFirebaseAuth ? _loadFirebaseAuth() : defaultLoadFirebaseAuth());
  const { initializeApp, getAuth, onAuthStateChanged, signInWithPopup, signOut, GoogleAuthProvider } = sdk;

  const firebaseApp = initializeApp(firebaseConfig);
  const authInstance = getAuth(firebaseApp);
  let lastAccessToken = null;

  const adapter = {
    onAuthStateChanged(cb) {
      return onAuthStateChanged(authInstance, cb);
    },
    async signInWithCredential() {
      // Real sign-in goes through signInWithGooglePopup() below, driven by
      // a user gesture (Safari blocks non-gesture popups). This method
      // exists only to satisfy the shape auth.js's Auth class expects.
      throw new Error(
        'Real sign-in uses signInWithGooglePopup(), not signInWithCredential() — call it from a click handler'
      );
    },
    async signOut() {
      lastAccessToken = null;
      return signOut(authInstance);
    },
    async signInWithGooglePopup() {
      const provider = new GoogleAuthProvider();
      provider.addScope(DRIVE_SCOPE);
      const result = await signInWithPopup(authInstance, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      lastAccessToken = credential?.accessToken ?? null;
      return result.user;
    },
    getAccessToken() {
      return lastAccessToken;
    },
  };

  return { auth: adapter, firebaseApp };
}

// Real Gemini adapter (Firebase AI Logic), shaped to match ai.js's expected
// client: { generate({model, prompt}) -> {text} }.
export async function createGeminiAdapter({ firebaseApp, model = 'gemini-1.5-flash', _loadFirebaseAI } = {}) {
  if (!firebaseApp) {
    throw new Error('createGeminiAdapter() requires the firebaseApp returned by createFirebaseAdapter()');
  }

  const { getAI, getGenerativeModel, GoogleAIBackend } = await (_loadFirebaseAI
    ? _loadFirebaseAI()
    : defaultLoadFirebaseAI());

  const ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
  const genModel = getGenerativeModel(ai, { model });

  return {
    async generate({ prompt }) {
      const result = await genModel.generateContent(prompt);
      return { text: result.response.text() };
    },
  };
}

// Real Google Drive adapter (Drive v3 REST via fetch), shaped to match
// drive.js's expected client: findFolder/createFolder/uploadFile/
// downloadFile/listFiles/deleteFile. Binary-safe: uses Blob concatenation
// for multipart upload and returns a Blob from downloadFile, so audio
// (mp4/AAC) round-trips without corruption (naive string/.text() handling
// of a multipart body would mangle binary payloads).
export function createDriveAdapter(getAccessToken, { _fetch = fetch } = {}) {
  if (typeof getAccessToken !== 'function') {
    throw new Error('createDriveAdapter() requires a getAccessToken function');
  }

  const DRIVE_API = 'https://www.googleapis.com/drive/v3';
  const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

  async function authFetch(url, options = {}) {
    const token = getAccessToken();
    if (!token) {
      throw new Error('No Google Drive access token available — sign in first');
    }
    const res = await _fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Drive API error ${res.status}: ${body}`);
    }
    return res;
  }

  return {
    async findFolder({ name, parentId }) {
      const escapedName = name.replace(/'/g, "\\'");
      const parentClause = parentId ? `'${parentId}' in parents` : `'root' in parents`;
      const q = encodeURIComponent(
        `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and ${parentClause}`
      );
      const res = await authFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`);
      const { files } = await res.json();
      return files && files[0] ? files[0] : null;
    },

    async createFolder({ name, parentId }) {
      const res = await authFetch(`${DRIVE_API}/files?fields=id,name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: parentId ? [parentId] : undefined,
        }),
      });
      return res.json();
    },

    async uploadFile({ name, mimeType, data, parentId }) {
      const boundary = `voiceframe-${Math.random().toString(16).slice(2)}`;
      const metadata = { name, mimeType, parents: parentId ? [parentId] : undefined };
      const mediaBlob =
        data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : JSON.stringify(data)], { type: mimeType });

      // Concatenated as Blob parts (not string concatenation) so the binary
      // media section is preserved byte-for-byte.
      const multipartBody = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
        mediaBlob,
        `\r\n--${boundary}--`,
      ]);

      const res = await authFetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipartBody,
      });
      return res.json();
    },

    async downloadFile(fileId) {
      const res = await authFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
      const data = await res.blob();
      return { data, mimeType: res.headers.get('content-type') };
    },

    async listFiles({ parentId }) {
      const q = encodeURIComponent(`'${parentId}' in parents and trashed = false`);
      const res = await authFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name,mimeType)`);
      const { files } = await res.json();
      return (files || []).map((f) => ({ ...f, parentId }));
    },

    async deleteFile(fileId) {
      await authFetch(`${DRIVE_API}/files/${fileId}`, { method: 'DELETE' });
      return true;
    },
  };
}
