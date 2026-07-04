function mockFirebase() {
  const listeners = [];
  let currentUser = null;
  return {
    auth: {
      onAuthStateChanged(cb) {
        listeners.push(cb);
        cb(currentUser);
      },
      async signInWithCredential() {
        throw new Error('unused in this fixture');
      },
      async signOut() {
        currentUser = null;
        listeners.forEach((listener) => listener(null));
      },
      async signInWithGooglePopup() {
        currentUser = { email: 'owner@example.com', uid: 'voice-notes-bootstrap-user' };
        listeners.forEach((listener) => listener(currentUser));
        return currentUser;
      },
    },
  };
}

window.__voiceNotesBootstrap = { status: 'starting' };

await new Promise((resolve) => setTimeout(resolve, 200));

window.__voiceNotesConfig = {
  debug: true,
  firebase: mockFirebase(),
  allowlist: ['owner@example.com'],
};

window.__voiceNotesBootstrap = { status: 'ready' };
