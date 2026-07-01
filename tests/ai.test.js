import test from 'node:test';
import assert from 'node:assert';
import { AI, buildInterpretPrompt, buildSummarizePrompt, extractJSON, validateAgainstSchema } from '../src/core/ai.js';

function createMockClient(responseText) {
  const calls = [];
  return {
    calls,
    async generate({ model, prompt }) {
      calls.push({ model, prompt });
      return { text: typeof responseText === 'function' ? responseText(prompt) : responseText };
    },
  };
}

test('buildInterpretPrompt: includes transcript and schema', () => {
  const prompt = buildInterpretPrompt('add milk', { type: 'object', properties: { item: { type: 'string' } } });
  assert.match(prompt, /add milk/);
  assert.match(prompt, /"item"/);
});

test('buildSummarizePrompt: includes the source text', () => {
  const prompt = buildSummarizePrompt('Remember to buy groceries tomorrow');
  assert.match(prompt, /Remember to buy groceries tomorrow/);
});

test('extractJSON: parses raw JSON', () => {
  const result = extractJSON('{"item":"milk","quantity":2}');
  assert.deepStrictEqual(result, { item: 'milk', quantity: 2 });
});

test('extractJSON: strips ```json fences', () => {
  const result = extractJSON('```json\n{"item":"milk"}\n```');
  assert.deepStrictEqual(result, { item: 'milk' });
});

test('extractJSON: strips plain ``` fences', () => {
  const result = extractJSON('```\n{"item":"milk"}\n```');
  assert.deepStrictEqual(result, { item: 'milk' });
});

test('extractJSON: throws on malformed JSON', () => {
  assert.throws(() => extractJSON('not json at all'), /not valid JSON/);
});

test('extractJSON: requires a string input', () => {
  assert.throws(() => extractJSON({ not: 'a string' }), /requires a string/);
});

test('validateAgainstSchema: passes when required fields present with correct types', () => {
  const schema = {
    type: 'object',
    properties: { item: { type: 'string' }, quantity: { type: 'number' } },
    required: ['item'],
  };
  assert.strictEqual(validateAgainstSchema({ item: 'milk', quantity: 2 }, schema), true);
});

test('validateAgainstSchema: throws on missing required field', () => {
  const schema = { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] };
  assert.throws(() => validateAgainstSchema({}, schema), /missing required field "item"/);
});

test('validateAgainstSchema: throws on type mismatch', () => {
  const schema = { type: 'object', properties: { quantity: { type: 'number' } } };
  assert.throws(() => validateAgainstSchema({ quantity: 'two' }, schema), /expected type "number"/);
});

test('validateAgainstSchema: array type detected correctly', () => {
  const schema = { type: 'object', properties: { items: { type: 'array' } } };
  assert.strictEqual(validateAgainstSchema({ items: [1, 2, 3] }, schema), true);
});

test('validateAgainstSchema: non-object schema is a no-op pass', () => {
  assert.strictEqual(validateAgainstSchema('anything', { type: 'string' }), true);
});

test('AI.interpret: returns parsed structured intent matching schema', async () => {
  const client = createMockClient('{"action":"add","item":"milk"}');
  const ai = new AI({ client });

  const schema = { type: 'object', properties: { action: { type: 'string' }, item: { type: 'string' } }, required: ['action', 'item'] };
  const result = await ai.interpret('add milk to the list', schema);

  assert.deepStrictEqual(result, { action: 'add', item: 'milk' });
  assert.strictEqual(client.calls.length, 1);
  assert.match(client.calls[0].prompt, /add milk to the list/);
});

test('AI.interpret: rejects malformed schema results', async () => {
  const client = createMockClient('{"action":"add"}'); // missing "item"
  const ai = new AI({ client });

  const schema = { type: 'object', properties: { action: { type: 'string' }, item: { type: 'string' } }, required: ['action', 'item'] };

  await assert.rejects(() => ai.interpret('add milk', schema), /missing required field "item"/);
});

test('AI.interpret: requires transcript and schema', async () => {
  const ai = new AI({ client: createMockClient('{}') });
  await assert.rejects(() => ai.interpret(null, {}), /requires a transcript/);
  await assert.rejects(() => ai.interpret('hi', null), /requires a schema/);
});

test('AI.interpret: throws when not configured with a client', async () => {
  const ai = new AI({});
  await assert.rejects(() => ai.interpret('hi', { type: 'object' }), /not configured with a Gemini client/);
});

test('AI.summarize: returns trimmed one-line summary', async () => {
  const client = createMockClient('  Buy milk and eggs  \n');
  const ai = new AI({ client });

  const summary = await ai.summarize('Remember: I need to buy milk and eggs from the store tomorrow morning.');

  assert.strictEqual(summary, 'Buy milk and eggs');
});

test('AI.summarize: requires text', async () => {
  const ai = new AI({ client: createMockClient('x') });
  await assert.rejects(() => ai.summarize(''), /requires text/);
});

test('AI.summarize: throws when not configured with a client', async () => {
  const ai = new AI({});
  await assert.rejects(() => ai.summarize('some text'), /not configured with a Gemini client/);
});

test('AI: uses configured model id in generate() call', async () => {
  const client = createMockClient('summary');
  const ai = new AI({ client, model: 'gemini-2.0-flash' });

  await ai.summarize('some text');

  assert.strictEqual(client.calls[0].model, 'gemini-2.0-flash');
});

test('AI: defaults to gemini-1.5-flash when no model specified', async () => {
  const client = createMockClient('summary');
  const ai = new AI({ client });

  await ai.summarize('some text');

  assert.strictEqual(client.calls[0].model, 'gemini-1.5-flash');
});
