import test from 'node:test';
import assert from 'node:assert';
import { CommandLog } from '../src/core/log.js';

function createMockDB() {
  const stores = { log: new Map(), fixtures: new Map() };
  return {
    stores,
    async put(storeName, record) { stores[storeName].set(record.id, record); return record; },
    async get(storeName, id) { return stores[storeName].get(id); },
    async getAll(storeName) { return Array.from(stores[storeName].values()); },
  };
}

test('CommandLog: record() stores a full command entry', async () => {
  const log = new CommandLog();
  const entry = await log.record({
    selector: '#record',
    type: 'say',
    transcript: 'buy milk',
    result: { ok: true },
  });

  assert.ok(entry.id);
  assert.strictEqual(entry.selector, '#record');
  assert.strictEqual(entry.type, 'say');
  assert.strictEqual(entry.transcript, 'buy milk');
  assert.deepStrictEqual(entry.result, { ok: true });
  assert.strictEqual(typeof entry.timestamp, 'number');
});

test('CommandLog: record() defaults optional fields to null', async () => {
  const log = new CommandLog();
  const entry = await log.record({ type: 'tap' });

  assert.strictEqual(entry.selector, null);
  assert.strictEqual(entry.transcript, null);
  assert.strictEqual(entry.result, null);
  assert.strictEqual(entry.detail, null);
});

test('CommandLog: getEntries returns all recorded commands', async () => {
  const log = new CommandLog();
  await log.record({ type: 'tap' });
  await log.record({ type: 'say', transcript: 'hello' });

  const entries = log.getEntries();
  assert.strictEqual(entries.length, 2);
});

test('CommandLog: getEntry retrieves by id', async () => {
  const log = new CommandLog();
  const entry = await log.record({ type: 'tap' });

  assert.strictEqual(log.getEntry(entry.id).id, entry.id);
  assert.strictEqual(log.getEntry('nonexistent'), null);
});

test('CommandLog: persists entries to localDB when provided', async () => {
  const db = createMockDB();
  const log = new CommandLog({ localDB: db });

  const entry = await log.record({ type: 'tap' });

  const stored = await db.get('log', entry.id);
  assert.ok(stored, 'entry should be persisted to localDB');
  assert.strictEqual(stored.id, entry.id);
});

test('CommandLog: attachDetail updates an existing entry', async () => {
  const log = new CommandLog();
  const entry = await log.record({ type: 'say', transcript: 'buy milk' });

  await log.attachDetail(entry.id, { interpretedAs: 'add-item' });

  assert.deepStrictEqual(log.getEntry(entry.id).detail, { interpretedAs: 'add-item' });
});

test('CommandLog: attachDetail throws for unknown entry', async () => {
  const log = new CommandLog();
  await assert.rejects(() => log.attachDetail('bogus', {}), /Log entry not found/);
});

test('CommandLog: correct() serializes a voice correction into a fixture', async () => {
  const log = new CommandLog();
  const entry = await log.record({ selector: '#item-42', type: 'say', transcript: 'mark this done' });

  const fixture = await log.correct(entry.id, {
    transcript: 'mark this as done',
    expected: { firestorePath: 'items/42', done: true },
  });

  assert.strictEqual(fixture.selector, '#item-42');
  assert.strictEqual(fixture.type, 'say');
  assert.strictEqual(fixture.transcript, 'mark this as done');
  assert.deepStrictEqual(fixture.expected, { firestorePath: 'items/42', done: true });
  assert.strictEqual(fixture.logId, entry.id);
});

test('CommandLog: correct() falls back to original transcript if none given', async () => {
  const log = new CommandLog();
  const entry = await log.record({ selector: '#item-42', type: 'say', transcript: 'mark this done' });

  const fixture = await log.correct(entry.id, { expected: { done: true } });

  assert.strictEqual(fixture.transcript, 'mark this done');
});

test('CommandLog: correct() requires an expected outcome', async () => {
  const log = new CommandLog();
  const entry = await log.record({ type: 'say', transcript: 'x' });

  await assert.rejects(() => log.correct(entry.id, {}), /requires an expected outcome/);
});

test('CommandLog: correct() throws for unknown log entry', async () => {
  const log = new CommandLog();
  await assert.rejects(() => log.correct('bogus', { expected: {} }), /Log entry not found/);
});

test('CommandLog: fixture round-trips through JSON serialization', async () => {
  const log = new CommandLog();
  const entry = await log.record({ selector: '#item-42', type: 'say', transcript: 'mark this done' });
  const fixture = await log.correct(entry.id, {
    transcript: 'mark this as done',
    expected: { firestorePath: 'items/42', done: true },
  });

  const serialized = JSON.stringify(fixture);
  const deserialized = JSON.parse(serialized);

  assert.deepStrictEqual(deserialized, fixture);
  assert.strictEqual(deserialized.selector, '#item-42');
  assert.strictEqual(deserialized.type, 'say');
  assert.deepStrictEqual(deserialized.expected, { firestorePath: 'items/42', done: true });
});

test('CommandLog: fixtures persist to localDB and are retrievable via getFixtures', async () => {
  const db = createMockDB();
  const log = new CommandLog({ localDB: db });
  const entry = await log.record({ selector: '#item-42', type: 'say', transcript: 'mark this done' });

  await log.correct(entry.id, { expected: { done: true } });

  const fixtures = await log.getFixtures();
  assert.strictEqual(fixtures.length, 1);
  assert.strictEqual(fixtures[0].logId, entry.id);
});

test('CommandLog: getFixtures returns empty array without localDB', async () => {
  const log = new CommandLog();
  const fixtures = await log.getFixtures();
  assert.deepStrictEqual(fixtures, []);
});

test('CommandLog: multiple corrections on the same entry produce distinct fixtures', async () => {
  const log = new CommandLog();
  const entry = await log.record({ selector: '#item-42', type: 'say', transcript: 'mark this done' });

  const fixture1 = await log.correct(entry.id, { expected: { done: true } });
  const fixture2 = await log.correct(entry.id, { expected: { done: false } });

  assert.notStrictEqual(fixture1.id, fixture2.id);
});
