// ai.js: Gemini integration (via Firebase AI Logic) — command interpretation
// and one-line summarization. See SPEC.md Code Style:
// `ctx.interpret(intentSchema) -> Gemini-parsed structured intent`.

export function buildInterpretPrompt(transcript, schema) {
  return [
    'You are a command interpreter for a voice-controlled web app.',
    `Given the transcript: "${transcript}"`,
    `Extract structured intent matching this JSON schema: ${JSON.stringify(schema)}`,
    'Respond with ONLY the JSON object, no surrounding text or markdown fences.',
  ].join('\n');
}

export function buildSummarizePrompt(text) {
  return [
    'Summarize the following text in one short line suitable as a file title.',
    'Respond with ONLY the summary, no quotes or surrounding text.',
    '',
    text,
  ].join('\n');
}

// Extracts a JSON object from a model response, tolerating ```json fences.
export function extractJSON(rawText) {
  if (typeof rawText !== 'string') {
    throw new Error('extractJSON() requires a string');
  }
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : rawText;
  try {
    return JSON.parse(candidate.trim());
  } catch (err) {
    throw new Error(`Model response was not valid JSON: ${err.message}`);
  }
}

// Minimal JSON-schema-like validator: checks required keys and primitive
// types for `{type: 'object', properties: {...}, required: [...]}` schemas.
export function validateAgainstSchema(value, schema) {
  if (!schema || schema.type !== 'object') return true;

  for (const key of schema.required ?? []) {
    if (!(key in (value ?? {}))) {
      throw new Error(`Schema validation failed: missing required field "${key}"`);
    }
  }

  for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
    if (!(key in (value ?? {}))) continue;
    const actual = value[key];
    const expectedType = propSchema.type;
    const actualType = Array.isArray(actual) ? 'array' : typeof actual;
    if (expectedType && actualType !== expectedType) {
      throw new Error(
        `Schema validation failed: field "${key}" expected type "${expectedType}", got "${actualType}"`
      );
    }
  }

  return true;
}

export class AI {
  constructor({ client, model = 'gemini-1.5-flash' } = {}) {
    this.client = client; // injected Gemini client, e.g. Firebase AI Logic model handle
    this.model = model;
  }

  async interpret(transcript, schema) {
    if (!transcript) throw new Error('interpret() requires a transcript');
    if (!schema) throw new Error('interpret() requires a schema');
    if (!this.client) throw new Error('AI not configured with a Gemini client');

    const prompt = buildInterpretPrompt(transcript, schema);
    const response = await this.client.generate({ model: this.model, prompt });
    const parsed = extractJSON(response.text);
    validateAgainstSchema(parsed, schema);
    return parsed;
  }

  async summarize(text) {
    if (!text) throw new Error('summarize() requires text');
    if (!this.client) throw new Error('AI not configured with a Gemini client');

    const prompt = buildSummarizePrompt(text);
    const response = await this.client.generate({ model: this.model, prompt });
    return response.text.trim();
  }
}

export function createAI(config) {
  return new AI(config);
}
