// db.js: IndexedDB local store — the on-device working set.
// May be evicted by iOS ITP after ~7 days of non-use; Firestore (sync.js) is the
// durability guarantee, not this module. Every record carries a `_ts` timestamp
// used by sync.js for last-write-wins reconciliation.

const DB_NAME = 'voiceframe';
const DB_VERSION = 1;
const STORES = ['mutations', 'metadata', 'outbox'];

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class LocalDB {
  constructor(idb) {
    this.idb = idb; // injected indexedDB implementation (global.indexedDB in browsers)
    this.db = null;
  }

  async open() {
    const request = this.idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };

    this.db = await promisifyRequest(request);
    return this;
  }

  _store(name, mode = 'readonly') {
    if (!this.db) throw new Error('LocalDB not opened; call open() first');
    if (!STORES.includes(name)) throw new Error(`Unknown store: ${name}`);
    const tx = this.db.transaction(name, mode);
    return tx.objectStore(name);
  }

  async put(storeName, record) {
    if (!record.id) throw new Error('Record requires an id');
    const withTimestamp = { ...record, _ts: record._ts ?? Date.now() };
    const store = this._store(storeName, 'readwrite');
    await promisifyRequest(store.put(withTimestamp));
    return withTimestamp;
  }

  async get(storeName, id) {
    const store = this._store(storeName, 'readonly');
    return promisifyRequest(store.get(id));
  }

  async getAll(storeName) {
    const store = this._store(storeName, 'readonly');
    return promisifyRequest(store.getAll());
  }

  async delete(storeName, id) {
    const store = this._store(storeName, 'readwrite');
    await promisifyRequest(store.delete(id));
    return true;
  }

  async clear(storeName) {
    const store = this._store(storeName, 'readwrite');
    await promisifyRequest(store.clear());
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export async function createLocalDB(idb) {
  const impl = idb || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!impl) {
    throw new Error('No IndexedDB implementation available');
  }
  const db = new LocalDB(impl);
  await db.open();
  return db;
}
