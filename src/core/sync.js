// sync.js: Firestore <-> local (IndexedDB) reconciliation.
// Firestore is the durability guarantee (survives iOS ITP eviction of IndexedDB),
// not merely a backup. Conflict policy is last-write-wins by record `_ts`
// (see SPEC.md Open Question 1 — resolved: data is private per user, no
// multi-writer merge handling needed).

export class Sync {
  constructor({ localDB, firestore, uid, collectionName = 'mutations' } = {}) {
    this.localDB = localDB;
    this.firestore = firestore; // injected Firestore-like client
    this.uid = uid;
    this.collectionName = collectionName;
    this.unsubscribe = null;
    this.online = true;
  }

  _collection() {
    if (!this.firestore || !this.uid) {
      throw new Error('Sync requires firestore + uid');
    }
    return this.firestore.collection(`users/${this.uid}/${this.collectionName}`);
  }

  setOnline(online) {
    this.online = online;
  }

  // Reconcile a single pair of records by last-write-wins on `_ts`.
  // Returns the record that should win.
  static reconcile(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    return (remote._ts ?? 0) >= (local._ts ?? 0) ? remote : local;
  }

  // Apply a remote snapshot's docs to the local store, keeping whichever side is newer.
  async applyRemoteSnapshot(docs) {
    for (const doc of docs) {
      const remote = { ...doc.data(), id: doc.id };
      const local = await this.localDB.get(this.collectionName, remote.id);
      const winner = Sync.reconcile(local, remote);
      if (winner === remote && (!local || remote._ts !== local._ts)) {
        await this.localDB.put(this.collectionName, remote);
      }
    }
  }

  start() {
    const collection = this._collection();
    this.unsubscribe = collection.onSnapshot((snapshot) => {
      this.applyRemoteSnapshot(snapshot.docs);
    });
    return this.unsubscribe;
  }

  stop() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  // Push a local mutation to Firestore. If offline, queue it in the outbox
  // for later reconciliation instead of losing the write.
  async push(record) {
    const stamped = await this.localDB.put(this.collectionName, record);

    if (!this.online) {
      await this.localDB.put('outbox', { id: stamped.id, record: stamped, queuedAt: Date.now() });
      return { queued: true, record: stamped };
    }

    try {
      await this._collection().doc(stamped.id).set(stamped);
      return { queued: false, record: stamped };
    } catch (err) {
      // Network failure mid-flight: fall back to queueing rather than losing the write.
      await this.localDB.put('outbox', { id: stamped.id, record: stamped, queuedAt: Date.now() });
      return { queued: true, record: stamped, error: err };
    }
  }

  // Drain the offline outbox once back online, pushing each queued mutation
  // to Firestore and removing it from the outbox on success.
  async drainOutbox() {
    const queued = await this.localDB.getAll('outbox');
    const results = [];

    for (const entry of queued) {
      try {
        await this._collection().doc(entry.record.id).set(entry.record);
        await this.localDB.delete('outbox', entry.id);
        results.push({ id: entry.id, success: true });
      } catch (err) {
        results.push({ id: entry.id, success: false, error: err });
      }
    }

    return results;
  }
}

export async function createSync(config) {
  return new Sync(config);
}
