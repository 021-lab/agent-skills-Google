// Unit tests for google-sdk.js. These test the ADAPTER LOGIC — request
// building, response parsing, event wiring — against mocked fetch and
// mocked injected SDK loaders. They do NOT call real Google/Firebase
// endpoints and do NOT prove the real CDN modules/versions are correct;
// see the NOTE ON VERIFICATION comment at the top of google-sdk.js.

import test from 'node:test';
import assert from 'node:assert';
import { createFirebaseAdapter, createGeminiAdapter, createDriveAdapter } from '../src/core/google-sdk.js';

// --- createFirebaseAdapter ---------------------------------------------

function mockFirebaseAuthSDK({ signInResult } = {}) {
  const stateListeners = [];
  const calls = { signInWithPopup: [], signOut: 0, addScope: [] };

  class MockGoogleAuthProvider {
    addScope(scope) {
      calls.addScope.push(scope);
    }
    static credentialFromResult(result) {
      return result._credential;
    }
  }

  return {
    calls,
    stateListeners,
    async loader() {
      return {
        initializeApp: (config) => ({ _config: config }),
        getAuth: (app) => ({ _app: app }),
        onAuthStateChanged: (auth, cb) => {
          stateListeners.push(cb);
          return () => {};
        },
        signInWithPopup: async (auth, provider) => {
          calls.signInWithPopup.push({ auth, provider });
          return signInResult;
        },
        signOut: async () => {
          calls.signOut += 1;
        },
        GoogleAuthProvider: MockGoogleAuthProvider,
      };
    },
  };
}

test('createFirebaseAdapter: requires firebaseConfig', async () => {
  await assert.rejects(() => createFirebaseAdapter(), /requires a firebaseConfig/);
});

test('createFirebaseAdapter: onAuthStateChanged delegates to the SDK', async () => {
  const mock = mockFirebaseAuthSDK();
  const { auth } = await createFirebaseAdapter({ apiKey: 'x' }, { _loadFirebaseAuth: mock.loader });

  let received = null;
  auth.onAuthStateChanged((user) => { received = user; });

  assert.strictEqual(mock.stateListeners.length, 1);
  mock.stateListeners[0]({ email: 'owner@example.com' });
  assert.deepStrictEqual(received, { email: 'owner@example.com' });
});

test('createFirebaseAdapter: signInWithCredential throws — real flow uses signInWithGooglePopup', async () => {
  const mock = mockFirebaseAuthSDK();
  const { auth } = await createFirebaseAdapter({ apiKey: 'x' }, { _loadFirebaseAuth: mock.loader });

  await assert.rejects(() => auth.signInWithCredential(), /signInWithGooglePopup/);
});

test('createFirebaseAdapter: signInWithGooglePopup requests the Drive scope and captures the access token', async () => {
  const signInResult = {
    user: { email: 'owner@example.com', uid: 'u1' },
    _credential: { accessToken: 'ya29.mock-token' },
  };
  const mock = mockFirebaseAuthSDK({ signInResult });
  const { auth } = await createFirebaseAdapter({ apiKey: 'x' }, { _loadFirebaseAuth: mock.loader });

  const user = await auth.signInWithGooglePopup();

  assert.deepStrictEqual(user, signInResult.user);
  assert.strictEqual(mock.calls.addScope[0], 'https://www.googleapis.com/auth/drive.file');
  assert.strictEqual(auth.getAccessToken(), 'ya29.mock-token');
});

test('createFirebaseAdapter: signOut clears the cached access token', async () => {
  const signInResult = {
    user: { email: 'owner@example.com', uid: 'u1' },
    _credential: { accessToken: 'ya29.mock-token' },
  };
  const mock = mockFirebaseAuthSDK({ signInResult });
  const { auth } = await createFirebaseAdapter({ apiKey: 'x' }, { _loadFirebaseAuth: mock.loader });

  await auth.signInWithGooglePopup();
  assert.strictEqual(auth.getAccessToken(), 'ya29.mock-token');

  await auth.signOut();
  assert.strictEqual(auth.getAccessToken(), null);
  assert.strictEqual(mock.calls.signOut, 1);
});

test('createFirebaseAdapter: getAccessToken is null before any sign-in', async () => {
  const mock = mockFirebaseAuthSDK();
  const { auth } = await createFirebaseAdapter({ apiKey: 'x' }, { _loadFirebaseAuth: mock.loader });

  assert.strictEqual(auth.getAccessToken(), null);
});

// --- createGeminiAdapter -------------------------------------------------

function mockFirebaseAISDK(responseText) {
  const calls = { getGenerativeModel: [], generateContent: [] };
  return {
    calls,
    async loader() {
      return {
        getAI: (app, opts) => ({ _app: app, _opts: opts }),
        getGenerativeModel: (ai, opts) => {
          calls.getGenerativeModel.push(opts);
          return {
            async generateContent(prompt) {
              calls.generateContent.push(prompt);
              return { response: { text: () => responseText } };
            },
          };
        },
        GoogleAIBackend: class {},
      };
    },
  };
}

test('createGeminiAdapter: requires a firebaseApp', async () => {
  await assert.rejects(() => createGeminiAdapter({}), /requires the firebaseApp/);
});

test('createGeminiAdapter: generate() returns the model text', async () => {
  const mock = mockFirebaseAISDK('Buy milk');
  const client = await createGeminiAdapter({ firebaseApp: { _fake: true }, _loadFirebaseAI: mock.loader });

  const result = await client.generate({ prompt: 'summarize: buy milk and eggs' });

  assert.deepStrictEqual(result, { text: 'Buy milk' });
  assert.strictEqual(mock.calls.generateContent[0], 'summarize: buy milk and eggs');
});

test('createGeminiAdapter: uses the configured model id', async () => {
  const mock = mockFirebaseAISDK('x');
  await createGeminiAdapter({ firebaseApp: { _fake: true }, model: 'gemini-2.0-flash', _loadFirebaseAI: mock.loader });

  assert.strictEqual(mock.calls.getGenerativeModel[0].model, 'gemini-2.0-flash');
});

// --- createDriveAdapter ---------------------------------------------------

function mockFetch(responses) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    const handler = responses.shift();
    if (!handler) throw new Error(`Unexpected fetch call: ${url}`);
    return handler(url, options);
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

test('createDriveAdapter: requires getAccessToken function', () => {
  assert.throws(() => createDriveAdapter(null), /requires a getAccessToken function/);
});

test('createDriveAdapter: throws when no access token is available', async () => {
  const drive = createDriveAdapter(() => null, { _fetch: mockFetch([]) });
  await assert.rejects(() => drive.findFolder({ name: 'x' }), /No Google Drive access token/);
});

test('createDriveAdapter: findFolder builds a query and returns the first match', async () => {
  const fetchImpl = mockFetch([
    () => jsonResponse({ files: [{ id: 'folder-1', name: 'VoiceFramework' }] }),
  ]);
  const drive = createDriveAdapter(() => 'token-123', { _fetch: fetchImpl });

  const folder = await drive.findFolder({ name: 'VoiceFramework', parentId: null });

  assert.deepStrictEqual(folder, { id: 'folder-1', name: 'VoiceFramework' });
  assert.match(fetchImpl.calls[0].url, /root.*in parents|files\?q=/);
  assert.strictEqual(fetchImpl.calls[0].options.headers.Authorization, 'Bearer token-123');
});

test('createDriveAdapter: findFolder returns null when nothing matches', async () => {
  const fetchImpl = mockFetch([() => jsonResponse({ files: [] })]);
  const drive = createDriveAdapter(() => 'token-123', { _fetch: fetchImpl });

  const folder = await drive.findFolder({ name: 'Nope' });
  assert.strictEqual(folder, null);
});

test('createDriveAdapter: createFolder POSTs folder metadata', async () => {
  const fetchImpl = mockFetch([() => jsonResponse({ id: 'folder-2', name: 'voice-notes' })]);
  const drive = createDriveAdapter(() => 'token-123', { _fetch: fetchImpl });

  const folder = await drive.createFolder({ name: 'voice-notes', parentId: 'folder-1' });

  assert.deepStrictEqual(folder, { id: 'folder-2', name: 'voice-notes' });
  const sentBody = JSON.parse(fetchImpl.calls[0].options.body);
  assert.strictEqual(sentBody.name, 'voice-notes');
  assert.strictEqual(sentBody.mimeType, 'application/vnd.google-apps.folder');
  assert.deepStrictEqual(sentBody.parents, ['folder-1']);
});

test('createDriveAdapter: uploadFile sends a multipart body containing the metadata and preserves binary data', async () => {
  let capturedBody = null;
  const fetchImpl = mockFetch([
    async (url, options) => {
      capturedBody = options.body;
      return jsonResponse({ id: 'file-1', name: 'note.txt' });
    },
  ]);
  const drive = createDriveAdapter(() => 'token-123', { _fetch: fetchImpl });

  const result = await drive.uploadFile({
    name: 'note.txt',
    mimeType: 'text/plain',
    data: 'hello world',
    parentId: 'folder-1',
  });

  assert.deepStrictEqual(result, { id: 'file-1', name: 'note.txt' });
  assert.ok(capturedBody instanceof Blob, 'body should be a Blob for binary-safe multipart construction');

  const bodyText = await capturedBody.text();
  assert.match(bodyText, /"name":"note.txt"/);
  assert.match(bodyText, /hello world/);
  assert.match(fetchImpl.calls[0].options.headers['Content-Type'], /multipart\/related; boundary=/);
});

test('createDriveAdapter: uploadFile preserves binary blob data byte-for-byte', async () => {
  let capturedBody = null;
  const fetchImpl = mockFetch([
    async (url, options) => { capturedBody = options.body; return jsonResponse({ id: 'file-2', name: 'audio.m4a' }); },
  ]);
  const drive = createDriveAdapter(() => 'token-123', { _fetch: fetchImpl });

  const binaryBytes = new Uint8Array([0x00, 0xff, 0x10, 0xab, 0xcd]);
  const audioBlob = new Blob([binaryBytes], { type: 'audio/mp4' });

  await drive.uploadFile({ name: 'audio.m4a', mimeType: 'audio/mp4', data: audioBlob, parentId: 'folder-1' });

  const bodyBuffer = new Uint8Array(await capturedBody.arrayBuffer());
  // The original bytes must appear intact somewhere in the multipart body.
  const bodyStr = Buffer.from(bodyBuffer).toString('latin1');
  const needle = Buffer.from(binaryBytes).toString('latin1');
  assert.ok(bodyStr.includes(needle), 'binary payload should be preserved byte-for-byte in the multipart body');
});

test('createDriveAdapter: downloadFile returns a Blob and content-type', async () => {
  const fakeBlob = new Blob(['file contents'], { type: 'text/plain' });
  const fetchImpl = mockFetch([
    () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/plain' },
      async blob() { return fakeBlob; },
      async text() { return ''; },
    }),
  ]);
  const drive = createDriveAdapter(() => 'token-123', { _fetch: fetchImpl });

  const result = await drive.downloadFile('file-1');

  assert.strictEqual(result.data, fakeBlob);
  assert.strictEqual(result.mimeType, 'text/plain');
});

test('createDriveAdapter: listFiles attaches parentId to each returned file', async () => {
  const fetchImpl = mockFetch([
    () => jsonResponse({ files: [{ id: 'f1', name: 'a.txt' }, { id: 'f2', name: 'b.txt' }] }),
  ]);
  const drive = createDriveAdapter(() => 'token-123', { _fetch: fetchImpl });

  const files = await drive.listFiles({ parentId: 'folder-1' });

  assert.strictEqual(files.length, 2);
  assert.strictEqual(files[0].parentId, 'folder-1');
  assert.strictEqual(files[1].parentId, 'folder-1');
});

test('createDriveAdapter: deleteFile sends a DELETE request', async () => {
  const fetchImpl = mockFetch([
    (url, options) => {
      assert.strictEqual(options.method, 'DELETE');
      return { ok: true, status: 204, headers: { get: () => null }, async text() { return ''; } };
    },
  ]);
  const drive = createDriveAdapter(() => 'token-123', { _fetch: fetchImpl });

  const result = await drive.deleteFile('file-1');
  assert.strictEqual(result, true);
});

test('createDriveAdapter: throws with response body detail on a non-ok response', async () => {
  const fetchImpl = mockFetch([
    () => jsonResponse({ error: 'insufficient permissions' }, { ok: false, status: 403 }),
  ]);
  const drive = createDriveAdapter(() => 'token-123', { _fetch: fetchImpl });

  await assert.rejects(() => drive.findFolder({ name: 'x' }), /Drive API error 403/);
});
