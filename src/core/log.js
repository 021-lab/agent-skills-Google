// log.js: command log (every user AND agent command) + voice-correction ->
// structured replayable fixture. Fixtures are the regression suite: each
// corrected command becomes a permanent test (see SPEC.md "Testing Strategy").

let counter = 0;
function generateId(prefix) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export class CommandLog {
  constructor({ localDB } = {}) {
    this.localDB = localDB;
    this.entries = [];
  }

  // entry: { selector, element, type, transcript, audioBlob, result, detail }
  async record(entry) {
    const record = {
      id: generateId('log'),
      timestamp: Date.now(),
      selector: entry.selector ?? null,
      type: entry.type,
      transcript: entry.transcript ?? null,
      result: entry.result ?? null,
      detail: entry.detail ?? null,
    };

    this.entries.push(record);

    if (this.localDB) {
      await this.localDB.put('log', record);
    }

    return record;
  }

  getEntries() {
    return [...this.entries];
  }

  getEntry(id) {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  // Attach structured detail to an existing log entry (ctx.log(detail) in the
  // app handler contract from SPEC.md Code Style).
  async attachDetail(id, detail) {
    const entry = this.getEntry(id);
    if (!entry) throw new Error(`Log entry not found: ${id}`);
    entry.detail = detail;
    if (this.localDB) {
      await this.localDB.put('log', entry);
    }
    return entry;
  }

  // Voice-correction -> structured replayable fixture.
  // {selector, type, transcript, expected} — round-trips through JSON.
  async correct(logId, { transcript, expected } = {}) {
    const entry = this.getEntry(logId);
    if (!entry) throw new Error(`Log entry not found: ${logId}`);
    if (expected === undefined) {
      throw new Error('correct() requires an expected outcome');
    }

    const fixture = {
      id: generateId('fixture'),
      logId: entry.id,
      selector: entry.selector,
      type: entry.type,
      transcript: transcript ?? entry.transcript,
      expected,
      createdAt: Date.now(),
    };

    if (this.localDB) {
      await this.localDB.put('fixtures', fixture);
    }

    return fixture;
  }

  async getFixtures() {
    if (!this.localDB) return [];
    return this.localDB.getAll('fixtures');
  }
}

export function createCommandLog(config) {
  return new CommandLog(config);
}
