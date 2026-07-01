import test from 'node:test';
import assert from 'node:assert';
import { LocalDB } from '../src/core/db.js';

// Minimal in-memory IndexedDB mock sufficient to exercise LocalDB's op shapes.
function createMockIDB() {
  const stores = { mutations: new Map(), metadata: new Map(), outbox: new Map() };

  function makeRequest(work) {
    const request = {};
    queueMicrotask(() => {
      try {
        request.result = work();
        if (request.onsuccess) request.onsuccess();
      } catch (err) {
        request.error = err;
        if (request.onerror) request.onerror();
      }
    });
    return request;
  }

  function makeStore(name, map) {
    return {
      put(record) { return makeRequest(() => { map.set(record.id, record); return record; }); },
      get(id) { return makeRequest(() => map.get(id)); },
      getAll() { return makeRequest(() => Array.from(map.values())); },
      delete(id) { return makeRequest(() => { map.delete(id); return true; }); },
      clear() { return makeRequest(() => { map.clear(); }); },
    };
  }

  const db = {
    objectStoreNames: { contains: (name) => name in stores },
    createObjectStore(name) { stores[name] = stores[name] || new Map(); return makeStore(name, stores[name]); },
    transaction(name) {
      return { objectStore: () => makeStore(name, stores[name]) };
    },
    close() {},
  };

  return {
    open(name, version) {
      const request = {};
      queueMicrotask(() => {
        if (request.onupgradeneeded) {
          request.onupgradeneeded({ target: { result: db } });
        }
        request.result = db;
        if (request.onsuccess) request.onsuccess();
      });
      return request;
    },
  };
}

test('LocalDB: open initializes without error', async () => {
  const idb = createMockIDB();
  const db = new LocalDB(idb);
  await db.open();
  assert.ok(db.db, 'db handle should be set after open()');
});

test('LocalDB: put assigns a _ts timestamp', async () => {
  const db = new LocalDB(createMockIDB());
  await db.open();

  const record = await db.put('mutations', { id: 'm1', action: 'insert' });
  assert.strictEqual(typeof record._ts, 'number', '_ts should be a number');
  assert.ok(record._ts > 0);
});

test('LocalDB: put preserves an explicit _ts if provided', async () => {
  const db = new LocalDB(createMockIDB());
  await db.open();

  const record = await db.put('mutations', { id: 'm1', action: 'insert', _ts: 12345 });
  assert.strictEqual(record._ts, 12345);
});

test('LocalDB: put requires an id', async () => {
  const db = new LocalDB(createMockIDB());
  await db.open();

  await assert.rejects(() => db.put('mutations', { action: 'insert' }), /requires an id/);
});

test('LocalDB: get retrieves a stored record', async () => {
  const db = new LocalDB(createMockIDB());
  await db.open();

  await db.put('mutations', { id: 'm1', action: 'insert' });
  const record = await db.get('mutations', 'm1');
  assert.strictEqual(record.id, 'm1');
  assert.strictEqual(record.action, 'insert');
});

test('LocalDB: get returns undefined for missing id', async () => {
  const db = new LocalDB(createMockIDB());
  await db.open();

  const record = await db.get('mutations', 'nonexistent');
  assert.strictEqual(record, undefined);
});

test('LocalDB: getAll returns all records in a store', async () => {
  const db = new LocalDB(createMockIDB());
  await db.open();

  await db.put('mutations', { id: 'm1' });
  await db.put('mutations', { id: 'm2' });

  const all = await db.getAll('mutations');
  assert.strictEqual(all.length, 2);
});

test('LocalDB: delete removes a record', async () => {
  const db = new LocalDB(createMockIDB());
  await db.open();

  await db.put('mutations', { id: 'm1' });
  await db.delete('mutations', 'm1');

  const record = await db.get('mutations', 'm1');
  assert.strictEqual(record, undefined);
});

test('LocalDB: clear empties a store', async () => {
  const db = new LocalDB(createMockIDB());
  await db.open();

  await db.put('mutations', { id: 'm1' });
  await db.put('mutations', { id: 'm2' });
  await db.clear('mutations');

  const all = await db.getAll('mutations');
  assert.strictEqual(all.length, 0);
});

test('LocalDB: rejects unknown store names', async () => {
  const db = new LocalDB(createMockIDB());
  await db.open();

  await assert.rejects(() => db.put('bogus', { id: 'x' }), /Unknown store/);
});

test('LocalDB: throws if used before open()', () => {
  const db = new LocalDB(createMockIDB());
  assert.throws(() => db._store('mutations'), /not opened/);
});

test('LocalDB: multiple stores are independent', async () => {
  const db = new LocalDB(createMockIDB());
  await db.open();

  await db.put('mutations', { id: 'shared-id', kind: 'mutation' });
  await db.put('metadata', { id: 'shared-id', kind: 'metadata' });

  const mutation = await db.get('mutations', 'shared-id');
  const metadata = await db.get('metadata', 'shared-id');

  assert.strictEqual(mutation.kind, 'mutation');
  assert.strictEqual(metadata.kind, 'metadata');
});
