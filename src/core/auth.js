// Auth: Google Identity Services + Firebase Auth, allowlist-restricted login
// Mandatory before any data access; no anonymous or non-Google auth paths

export class Auth {
  constructor({ googleClientId, firebase, allowlist } = {}) {
    this.googleClientId = googleClientId;
    this.firebase = firebase; // Firebase app/auth instance, injected by caller
    this.allowlist = allowlist || [];
    this.currentUser = null;
    this.state = 'signed-out'; // signed-out | signing-in | signed-in | rejected
    this.listeners = [];
    this._forcingSignOut = false;
  }

  async init() {
    if (!this.firebase || !this.firebase.auth) {
      throw new Error('Auth requires a Firebase Auth instance');
    }

    // Restore session if Firebase has a persisted user.
    // This is the single place user changes are processed — signIn() relies on it
    // rather than calling handleSignedIn itself, to avoid double-processing.
    this.firebase.auth.onAuthStateChanged((user) => {
      if (user) {
        this.handleSignedIn(user);
      } else if (!this._forcingSignOut) {
        this.currentUser = null;
        this.state = 'signed-out';
        this.notify();
      }
    });

    return this;
  }

  isAllowed(email) {
    if (!email) return false;
    if (this.allowlist.length === 0) return false; // fail closed: no allowlist = no access
    return this.allowlist.includes(email.toLowerCase());
  }

  handleSignedIn(user) {
    const email = user.email ? user.email.toLowerCase() : null;

    if (!this.isAllowed(email)) {
      this.state = 'rejected';
      this.currentUser = null;
      // Force sign-out: an authenticated-but-disallowed user must not retain a session.
      // Suppress the resulting onAuthStateChanged(null) from overwriting 'rejected'.
      this._forcingSignOut = true;
      Promise.resolve(this.firebase.auth.signOut()).finally(() => {
        this._forcingSignOut = false;
      });
      this.notify();
      return;
    }

    this.currentUser = user;
    this.state = 'signed-in';
    this.notify();
  }

  async signIn(googleCredential) {
    if (!this.firebase || !this.firebase.auth) {
      throw new Error('Auth not initialized');
    }

    this.state = 'signing-in';
    this.notify();

    try {
      // Do not call handleSignedIn here: the onAuthStateChanged listener registered
      // in init() is the single place user changes are processed, and will already
      // have applied the allowlist check and updated state by the time this resolves.
      await this.firebase.auth.signInWithCredential(googleCredential);

      // If rejected, state/currentUser were already finalized by the listener above.
      return this.currentUser;
    } catch (err) {
      if (this.state !== 'rejected') {
        this.state = 'signed-out';
        this.currentUser = null;
        this.notify();
      }
      throw err;
    }
  }

  async signOut() {
    if (this.firebase && this.firebase.auth) {
      // The onAuthStateChanged listener registered in init() handles the resulting
      // state transition and notification; avoid duplicating that here.
      await this.firebase.auth.signOut();
      return;
    }
    this.currentUser = null;
    this.state = 'signed-out';
    this.notify();
  }

  requireAuth() {
    if (this.state !== 'signed-in' || !this.currentUser) {
      throw new Error('Authentication required before data access');
    }
    return this.currentUser;
  }

  isSignedIn() {
    return this.state === 'signed-in' && this.currentUser !== null;
  }

  getUser() {
    return this.currentUser;
  }

  getState() {
    return this.state;
  }

  onChange(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    for (const listener of this.listeners) {
      listener({ state: this.state, user: this.currentUser });
    }
  }
}

export async function createAuth(config) {
  const auth = new Auth(config);
  await auth.init();
  return auth;
}
