import test from 'node:test';
import assert from 'node:assert';
import { UndoStack, recordPutMutation, recordDeleteMutation } from '../src/core/undo.js';

function createMockDB() {
  const store = new Map();
  return {
    store,
    async put(storeName, record) { store.set(record.id, record); return record; },
    async get(storeName, id) { return store.get(id); },
    async delete(storeName, id) { store.delete(id); },
  };
}

test('UndoStack: push requires an inverse function', () => {
  const stack = new UndoStack();
  assert.throws(() => stack.push({ mutation: {} }), /requires an action with an inverse/);
});

test('UndoStack: canUndo and depth reflect stack size', () => {
  const stack = new UndoStack();
  assert.strictEqual(stack.canUndo(), false);
  assert.strictEqual(stack.depth(), 0);

  stack.push({ mutation: {}, inverse: () => {} });
  assert.strictEqual(stack.canUndo(), true);
  assert.strictEqual(stack.depth(), 1);
});

test('UndoStack: undo() applies the inverse and pops the stack', async () => {
  const stack = new UndoStack();
  let applied = false;
  stack.push({ mutation: {}, inverse: () => { applied = true; } });

  const action = await stack.undo();

  assert.strictEqual(applied, true);
  assert.strictEqual(stack.depth(), 0);
  assert.ok(action);
});

test('UndoStack: undo() on empty stack returns null', async () => {
  const stack = new UndoStack();
  const result = await stack.undo();
  assert.strictEqual(result, null);
});

test('UndoStack: N undo operations reverse N mutations in LIFO order', async () => {
  const stack = new UndoStack();
  const order = [];

  stack.push({ mutation: { id: 1 }, inverse: () => order.push(1) });
  stack.push({ mutation: { id: 2 }, inverse: () => order.push(2) });
  stack.push({ mutation: { id: 3 }, inverse: () => order.push(3) });

  await stack.undoN(3);

  assert.deepStrictEqual(order, [3, 2, 1], 'inverses should apply in LIFO order');
  assert.strictEqual(stack.depth(), 0);
});

test('UndoStack: undoN stops early if stack empties', async () => {
  const stack = new UndoStack();
  stack.push({ mutation: {}, inverse: () => {} });

  const applied = await stack.undoN(5);

  assert.strictEqual(applied.length, 1, 'should only apply as many as were on the stack');
});

test('UndoStack: clear empties the stack', () => {
  const stack = new UndoStack();
  stack.push({ mutation: {}, inverse: () => {} });
  stack.clear();
  assert.strictEqual(stack.depth(), 0);
});

test('UndoStack: supports async inverses', async () => {
  const stack = new UndoStack();
  let resolved = false;
  stack.push({
    mutation: {},
    inverse: async () => {
      await new Promise((r) => setTimeout(r, 5));
      resolved = true;
    },
  });

  await stack.undo();
  assert.strictEqual(resolved, true);
});

test('recordPutMutation: inverse restores previous value on undo', async () => {
  const db = createMockDB();
  await db.put('mutations', { id: 'm1', value: 'original' });

  const action = recordPutMutation({
    db,
    storeName: 'mutations',
    id: 'm1',
    previousValue: { id: 'm1', value: 'original' },
    newValue: { id: 'm1', value: 'changed' },
  });
  await db.put('mutations', { id: 'm1', value: 'changed' });

  const stack = new UndoStack();
  stack.push(action);
  await stack.undo();

  const record = await db.get('mutations', 'm1');
  assert.strictEqual(record.value, 'original');
});

test('recordPutMutation: inverse deletes record that was newly inserted', async () => {
  const db = createMockDB();
  await db.put('mutations', { id: 'm1', value: 'new' });

  const action = recordPutMutation({
    db,
    storeName: 'mutations',
    id: 'm1',
    previousValue: undefined,
    newValue: { id: 'm1', value: 'new' },
  });

  const stack = new UndoStack();
  stack.push(action);
  await stack.undo();

  const record = await db.get('mutations', 'm1');
  assert.strictEqual(record, undefined, 'inserted record should be removed on undo');
});

test('recordDeleteMutation: inverse restores the deleted record', async () => {
  const db = createMockDB();
  const previousValue = { id: 'm1', value: 'existed' };

  const action = recordDeleteMutation({ db, storeName: 'mutations', id: 'm1', previousValue });
  await db.delete('mutations', 'm1');

  const stack = new UndoStack();
  stack.push(action);
  await stack.undo();

  const record = await db.get('mutations', 'm1');
  assert.strictEqual(record.value, 'existed');
});

test('Undo/redo simulation: N mutating commands undone in LIFO restores prior state', async () => {
  const db = createMockDB();
  const stack = new UndoStack();

  // Simulate three sequential mutations on the same record
  await db.put('mutations', { id: 'm1', value: 'v1' });
  stack.push(recordPutMutation({ db, storeName: 'mutations', id: 'm1', previousValue: undefined, newValue: { id: 'm1', value: 'v1' } }));

  const afterV1 = await db.get('mutations', 'm1');
  await db.put('mutations', { id: 'm1', value: 'v2' });
  stack.push(recordPutMutation({ db, storeName: 'mutations', id: 'm1', previousValue: afterV1, newValue: { id: 'm1', value: 'v2' } }));

  const afterV2 = await db.get('mutations', 'm1');
  await db.put('mutations', { id: 'm1', value: 'v3' });
  stack.push(recordPutMutation({ db, storeName: 'mutations', id: 'm1', previousValue: afterV2, newValue: { id: 'm1', value: 'v3' } }));

  assert.strictEqual((await db.get('mutations', 'm1')).value, 'v3');

  await stack.undo();
  assert.strictEqual((await db.get('mutations', 'm1')).value, 'v2');

  await stack.undo();
  assert.strictEqual((await db.get('mutations', 'm1')).value, 'v1');

  await stack.undo();
  assert.strictEqual(await db.get('mutations', 'm1'), undefined, 'fully undone back to nonexistent');
});
