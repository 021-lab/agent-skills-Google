import test from 'node:test';
import assert from 'node:assert';
import { Auth } from '../src/core/auth.js';

function mockFirebase(initialUser = null) {
  const listeners = [];
  let currentUser = initialUser;

  return {
    auth: {
      onAuthStateChanged(cb) {
        listeners.push(cb);
        cb(currentUser);
      },
      async signInWithCredential(credential) {
        currentUser = credential.user;
        listeners.forEach(l => l(currentUser));
        return { user: currentUser };
      },
      async signOut() {
        currentUser = null;
        listeners.forEach(l => l(null));
      },
    },
  };
}

test('Auth: fails closed with empty allowlist', async () => {
  const firebase = mockFirebase();
  const auth = new Auth({ firebase, allowlist: [] });
  await auth.init();

  assert.strictEqual(auth.isAllowed('owner@example.com'), false, 'Empty allowlist should reject everyone');
});

test('Auth: allows email on allowlist (case-insensitive)', async () => {
  const firebase = mockFirebase();
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  assert.strictEqual(auth.isAllowed('Owner@Example.com'), true, 'Should match case-insensitively');
  assert.strictEqual(auth.isAllowed('stranger@example.com'), false, 'Should reject non-allowlisted email');
});

test('Auth: signIn succeeds for allowlisted user', async () => {
  const firebase = mockFirebase();
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  const user = await auth.signIn({ user: { email: 'owner@example.com', uid: '123' } });

  assert.strictEqual(auth.isSignedIn(), true);
  assert.strictEqual(auth.getState(), 'signed-in');
  assert.strictEqual(user.email, 'owner@example.com');
});

test('Auth: signIn rejects and force-signs-out non-allowlisted user', async () => {
  const firebase = mockFirebase();
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  await auth.signIn({ user: { email: 'stranger@example.com', uid: '999' } });

  assert.strictEqual(auth.isSignedIn(), false, 'Non-allowlisted user should not be signed in');
  assert.strictEqual(auth.getState(), 'rejected');
  assert.strictEqual(auth.getUser(), null);
});

test('Auth: requireAuth throws when signed out', async () => {
  const firebase = mockFirebase();
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  assert.throws(() => auth.requireAuth(), /Authentication required/);
});

test('Auth: requireAuth returns user when signed in', async () => {
  const firebase = mockFirebase();
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  await auth.signIn({ user: { email: 'owner@example.com', uid: '123' } });

  const user = auth.requireAuth();
  assert.strictEqual(user.uid, '123');
});

test('Auth: signOut clears state', async () => {
  const firebase = mockFirebase();
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  await auth.signIn({ user: { email: 'owner@example.com', uid: '123' } });
  assert.strictEqual(auth.isSignedIn(), true);

  await auth.signOut();
  assert.strictEqual(auth.isSignedIn(), false);
  assert.strictEqual(auth.getState(), 'signed-out');
});

test('Auth: onChange notifies listeners on state transitions', async () => {
  const firebase = mockFirebase();
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  const events = [];
  auth.onChange(({ state }) => events.push(state));

  await auth.signIn({ user: { email: 'owner@example.com', uid: '123' } });
  await auth.signOut();

  assert.deepStrictEqual(events, ['signing-in', 'signed-in', 'signed-out']);
});

test('Auth: onChange unsubscribe stops notifications', async () => {
  const firebase = mockFirebase();
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  const events = [];
  const unsubscribe = auth.onChange(({ state }) => events.push(state));
  unsubscribe();

  await auth.signIn({ user: { email: 'owner@example.com', uid: '123' } });

  assert.deepStrictEqual(events, [], 'Listener should not fire after unsubscribe');
});

test('Auth: session restored from onAuthStateChanged persists allowlisted user', async () => {
  const initialUser = { email: 'owner@example.com', uid: '123' };
  const firebase = mockFirebase(initialUser);
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  assert.strictEqual(auth.isSignedIn(), true, 'Should restore signed-in state on init');
});

test('Auth: session restored for non-allowlisted user is rejected', async () => {
  const initialUser = { email: 'stranger@example.com', uid: '999' };
  const firebase = mockFirebase(initialUser);
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  assert.strictEqual(auth.isSignedIn(), false, 'Restored session for disallowed user should be rejected');
});

test('Auth: init throws without Firebase auth instance', async () => {
  const auth = new Auth({ allowlist: ['owner@example.com'] });

  await assert.rejects(() => auth.init(), /requires a Firebase Auth instance/);
});

test('Auth: signInWithGooglePopup throws when the provider does not support it', async () => {
  const firebase = mockFirebase(); // mockFirebase's auth has no signInWithGooglePopup
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  await assert.rejects(() => auth.signInWithGooglePopup(), /not supported by the configured auth provider/);
});

test('Auth: signInWithGooglePopup delegates to the adapter and the resulting onAuthStateChanged applies the allowlist', async () => {
  // Mimics google-sdk.js's real adapter: signInWithGooglePopup() resolves
  // with the user, and separately triggers the same onAuthStateChanged
  // listeners a real Firebase SDK would fire once the popup completes.
  const listeners = [];
  const firebase = {
    auth: {
      onAuthStateChanged(cb) { listeners.push(cb); cb(null); },
      async signInWithCredential() { throw new Error('unused'); },
      async signOut() { listeners.forEach((l) => l(null)); },
      async signInWithGooglePopup() {
        const user = { email: 'owner@example.com', uid: 'popup-uid' };
        listeners.forEach((l) => l(user));
        return user;
      },
    },
  };
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  const user = await auth.signInWithGooglePopup();

  assert.strictEqual(user.uid, 'popup-uid');
  assert.strictEqual(auth.isSignedIn(), true);
  assert.strictEqual(auth.getState(), 'signed-in');
});

test('Auth: signInWithGooglePopup surfaces a rejected (non-allowlisted) popup sign-in', async () => {
  const listeners = [];
  const firebase = {
    auth: {
      onAuthStateChanged(cb) { listeners.push(cb); cb(null); },
      async signInWithCredential() { throw new Error('unused'); },
      async signOut() { listeners.forEach((l) => l(null)); },
      async signInWithGooglePopup() {
        const user = { email: 'stranger@example.com', uid: 'popup-uid' };
        listeners.forEach((l) => l(user));
        return user;
      },
    },
  };
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  await auth.signInWithGooglePopup();

  assert.strictEqual(auth.isSignedIn(), false);
  assert.strictEqual(auth.getState(), 'rejected');
});

test('Auth: signInWithGooglePopup propagates a thrown error (e.g. user closed the popup)', async () => {
  const firebase = {
    auth: {
      onAuthStateChanged(cb) { cb(null); },
      async signInWithCredential() { throw new Error('unused'); },
      async signOut() {},
      async signInWithGooglePopup() { throw new Error('popup closed by user'); },
    },
  };
  const auth = new Auth({ firebase, allowlist: ['owner@example.com'] });
  await auth.init();

  await assert.rejects(() => auth.signInWithGooglePopup(), /popup closed by user/);
  assert.strictEqual(auth.getState(), 'signed-out');
});
