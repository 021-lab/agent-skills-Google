import test from 'node:test';
import assert from 'node:assert';
import { Sync } from '../src/core/sync.js';

// In-memory LocalDB stand-in — sync.js only needs get/put/getAll/delete.
function createMockLocalDB() {
  const stores = { mutations: new Map(), outbox: new Map() };
  return {
    stores,
    async get(store, id) { return stores[store].get(id); },
    async put(store, record) {
      const withTs = { ...record, _ts: record._ts ?? Date.now() };
      stores[store].set(withTs.id, withTs);
      return withTs;
    },
    async getAll(store) { return Array.from(stores[store].values()); },
    async delete(store, id) { stores[store].delete(id); },
  };
}

// In-memory Firestore stand-in.
function createMockFirestore() {
  const docs = new Map();
  let snapshotCallback = null;
  return {
    docs,
    collection(path) {
      return {
        doc(id) {
          return {
            async set(data) {
              docs.set(id, data);
              if (snapshotCallback) {
                snapshotCallback({
                  docs: Array.from(docs.entries()).map(([docId, data]) => ({
                    id: docId,
                    data: () => data,
                  })),
                });
              }
            },
            async get() {
              return { id, data: () => docs.get(id) };
            },
          };
        },
        onSnapshot(cb) {
          snapshotCallback = cb;
          cb({
            docs: Array.from(docs.entries()).map(([docId, data]) => ({
              id: docId,
              data: () => data,
            })),
          });
          return () => { snapshotCallback = null; };
        },
      };
    },
  };
}

test('Sync.reconcile: remote wins when newer', () => {
  const local = { id: '1', _ts: 100, value: 'old' };
  const remote = { id: '1', _ts: 200, value: 'new' };
  assert.strictEqual(Sync.reconcile(local, remote), remote);
});

test('Sync.reconcile: local wins when newer', () => {
  const local = { id: '1', _ts: 200, value: 'new' };
  const remote = { id: '1', _ts: 100, value: 'old' };
  assert.strictEqual(Sync.reconcile(local, remote), local);
});

test('Sync.reconcile: remote wins on equal timestamps (tie-break to remote)', () => {
  const local = { id: '1', _ts: 100 };
  const remote = { id: '1', _ts: 100 };
  assert.strictEqual(Sync.reconcile(local, remote), remote);
});

test('Sync.reconcile: handles missing local', () => {
  const remote = { id: '1', _ts: 100 };
  assert.strictEqual(Sync.reconcile(null, remote), remote);
});

test('Sync.reconcile: handles missing remote', () => {
  const local = { id: '1', _ts: 100 };
  assert.strictEqual(Sync.reconcile(local, null), local);
});

test('Sync: push writes locally and to firestore when online', async () => {
  const localDB = createMockLocalDB();
  const firestore = createMockFirestore();
  const sync = new Sync({ localDB, firestore, uid: 'user1' });

  const result = await sync.push({ id: 'm1', action: 'insert' });

  assert.strictEqual(result.queued, false);
  assert.ok(firestore.docs.has('m1'), 'record should be written to firestore');
});

test('Sync: push queues to outbox when offline', async () => {
  const localDB = createMockLocalDB();
  const firestore = createMockFirestore();
  const sync = new Sync({ localDB, firestore, uid: 'user1' });
  sync.setOnline(false);

  const result = await sync.push({ id: 'm1', action: 'insert' });

  assert.strictEqual(result.queued, true);
  assert.strictEqual(firestore.docs.has('m1'), false, 'should not reach firestore while offline');
  const outbox = await localDB.getAll('outbox');
  assert.strictEqual(outbox.length, 1);
});

test('Sync: drainOutbox pushes queued mutations and clears them', async () => {
  const localDB = createMockLocalDB();
  const firestore = createMockFirestore();
  const sync = new Sync({ localDB, firestore, uid: 'user1' });

  sync.setOnline(false);
  await sync.push({ id: 'm1', action: 'insert' });
  await sync.push({ id: 'm2', action: 'insert' });

  sync.setOnline(true);
  const results = await sync.drainOutbox();

  assert.strictEqual(results.length, 2);
  assert.ok(results.every(r => r.success));
  assert.ok(firestore.docs.has('m1'));
  assert.ok(firestore.docs.has('m2'));

  const remainingOutbox = await localDB.getAll('outbox');
  assert.strictEqual(remainingOutbox.length, 0, 'outbox should be drained');
});

test('Sync: applyRemoteSnapshot writes newer remote records locally', async () => {
  const localDB = createMockLocalDB();
  const firestore = createMockFirestore();
  const sync = new Sync({ localDB, firestore, uid: 'user1' });

  await localDB.put('mutations', { id: 'm1', value: 'local-old', _ts: 100 });

  await sync.applyRemoteSnapshot([
    { id: 'm1', data: () => ({ value: 'remote-new', _ts: 200 }) },
  ]);

  const record = await localDB.get('mutations', 'm1');
  assert.strictEqual(record.value, 'remote-new');
});

test('Sync: applyRemoteSnapshot does not overwrite newer local records', async () => {
  const localDB = createMockLocalDB();
  const firestore = createMockFirestore();
  const sync = new Sync({ localDB, firestore, uid: 'user1' });

  await localDB.put('mutations', { id: 'm1', value: 'local-new', _ts: 300 });

  await sync.applyRemoteSnapshot([
    { id: 'm1', data: () => ({ value: 'remote-old', _ts: 100 }) },
  ]);

  const record = await localDB.get('mutations', 'm1');
  assert.strictEqual(record.value, 'local-new', 'newer local record should win');
});

test('Sync: start() subscribes and applies initial snapshot', async () => {
  const localDB = createMockLocalDB();
  const firestore = createMockFirestore();
  await firestore.collection('users/user1/mutations').doc('m1').set({ id: 'm1', value: 'seed', _ts: 50 });

  const sync = new Sync({ localDB, firestore, uid: 'user1' });
  sync.start();

  // onSnapshot mock invokes the callback synchronously, but applyRemoteSnapshot()
  // itself is async (awaits localDB reads/writes) and is not awaited by start();
  // let its microtasks settle before asserting.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const record = await localDB.get('mutations', 'm1');
  assert.strictEqual(record.value, 'seed');
});

test('Sync: stop() unsubscribes cleanly', () => {
  const localDB = createMockLocalDB();
  const firestore = createMockFirestore();
  const sync = new Sync({ localDB, firestore, uid: 'user1' });

  sync.start();
  assert.doesNotThrow(() => sync.stop());
  assert.strictEqual(sync.unsubscribe, null);
});

test('Sync: requires firestore + uid to build a collection ref', () => {
  const localDB = createMockLocalDB();
  const sync = new Sync({ localDB });
  assert.throws(() => sync._collection(), /requires firestore \+ uid/);
});

test('Sync: push failure mid-flight falls back to outbox queue', async () => {
  const localDB = createMockLocalDB();
  const firestore = {
    collection() {
      return {
        doc() {
          return { set: async () => { throw new Error('network down'); } };
        },
        onSnapshot() { return () => {}; },
      };
    },
  };
  const sync = new Sync({ localDB, firestore, uid: 'user1' });

  const result = await sync.push({ id: 'm1', action: 'insert' });

  assert.strictEqual(result.queued, true);
  assert.ok(result.error);
  const outbox = await localDB.getAll('outbox');
  assert.strictEqual(outbox.length, 1);
});
