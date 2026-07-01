// Fixture for tests/signin-ui.e2e.spec.js: proves the UI chrome's real
// sign-in button renders and works in an actual browser. Uses a mock
// firebase.auth that implements signInWithGooglePopup (unlike the other
// fixtures' minimal mocks), since that's the method the button calls.
import { VoiceApp } from '/src/voiceframe.js';

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
        listeners.forEach((l) => l(null));
      },
      async signInWithGooglePopup() {
        currentUser = { email: 'owner@example.com', uid: 'popup-uid' };
        listeners.forEach((l) => l(currentUser));
        return currentUser;
      },
    },
  };
}

const app = await VoiceApp.init({
  debug: true,
  firebase: mockFirebase(),
  allowlist: ['owner@example.com'],
});

window.__voiceframeApp = app;
