import test from 'node:test';
import assert from 'node:assert';
import { Drive } from '../src/core/drive.js';

function createMockClient() {
  const folders = new Map(); // key: `${parentId}/${name}` -> {id, name}
  const files = new Map(); // id -> {id, name, mimeType, data, parentId}
  let nextId = 1;

  return {
    folders,
    files,
    async findFolder({ name, parentId }) {
      const key = `${parentId ?? 'root'}/${name}`;
      return folders.get(key) || null;
    },
    async createFolder({ name, parentId }) {
      const id = `folder-${nextId++}`;
      const key = `${parentId ?? 'root'}/${name}`;
      const folder = { id, name };
      folders.set(key, folder);
      return folder;
    },
    async uploadFile({ name, mimeType, data, parentId }) {
      const id = `file-${nextId++}`;
      const file = { id, name, mimeType, data, parentId };
      files.set(id, file);
      return { id, name, webViewLink: `https://drive.example/${id}` };
    },
    async downloadFile(fileId) {
      const file = files.get(fileId);
      if (!file) throw new Error('File not found');
      return { data: file.data, mimeType: file.mimeType };
    },
    async listFiles({ parentId }) {
      return Array.from(files.values()).filter(f => f.parentId === parentId);
    },
    async deleteFile(fileId) {
      return files.delete(fileId);
    },
  };
}

test('Drive: upload creates app folder structure and uploads file', async () => {
  const client = createMockClient();
  const drive = new Drive({ client, appId: 'voice-notes' });

  const result = await drive.upload({ name: 'note.txt', blob: { data: 'hello' }, mimeType: 'text/plain' });

  assert.ok(result.id);
  assert.strictEqual(result.name, 'note.txt');
  // Root + app folder should both be created
  assert.strictEqual(client.folders.size, 2);
});

test('Drive: upload reuses cached folder ids across calls', async () => {
  const client = createMockClient();
  const drive = new Drive({ client, appId: 'voice-notes' });

  await drive.upload({ name: 'a.txt', blob: { data: '1' } });
  await drive.upload({ name: 'b.txt', blob: { data: '2' } });

  // Folder should only be created once (cached), not per-upload
  assert.strictEqual(client.folders.size, 2);
});

test('Drive: upload requires name and blob', async () => {
  const client = createMockClient();
  const drive = new Drive({ client, appId: 'voice-notes' });

  await assert.rejects(() => drive.upload({ blob: { data: 'x' } }), /requires a name/);
  await assert.rejects(() => drive.upload({ name: 'x.txt' }), /requires a blob/);
});

test('Drive: download retrieves uploaded file data', async () => {
  const client = createMockClient();
  const drive = new Drive({ client, appId: 'voice-notes' });

  const uploaded = await drive.upload({ name: 'note.txt', blob: { data: 'hello world' }, mimeType: 'text/plain' });
  const downloaded = await drive.download(uploaded.id);

  assert.deepStrictEqual(downloaded.data, { data: 'hello world' });
  assert.strictEqual(downloaded.mimeType, 'text/plain');
});

test('Drive: download requires fileId', async () => {
  const client = createMockClient();
  const drive = new Drive({ client, appId: 'voice-notes' });

  await assert.rejects(() => drive.download(), /requires a fileId/);
});

test('Drive: list returns only files within this app folder', async () => {
  const client = createMockClient();
  const driveA = new Drive({ client, appId: 'app-a' });
  const driveB = new Drive({ client, appId: 'app-b' });

  await driveA.upload({ name: 'a1.txt', blob: { data: '1' } });
  await driveB.upload({ name: 'b1.txt', blob: { data: '2' } });

  const filesA = await driveA.list();
  const filesB = await driveB.list();

  assert.strictEqual(filesA.length, 1);
  assert.strictEqual(filesA[0].name, 'a1.txt');
  assert.strictEqual(filesB.length, 1);
  assert.strictEqual(filesB[0].name, 'b1.txt');
});

test('Drive: delete removes a file', async () => {
  const client = createMockClient();
  const drive = new Drive({ client, appId: 'voice-notes' });

  const uploaded = await drive.upload({ name: 'note.txt', blob: { data: 'x' } });
  await drive.delete(uploaded.id);

  await assert.rejects(() => drive.download(uploaded.id), /File not found/);
});

test('Drive: delete requires fileId', async () => {
  const client = createMockClient();
  const drive = new Drive({ client, appId: 'voice-notes' });

  await assert.rejects(() => drive.delete(), /requires a fileId/);
});

test('Drive: works without appId (uses root folder only)', async () => {
  const client = createMockClient();
  const drive = new Drive({ client });

  const result = await drive.upload({ name: 'note.txt', blob: { data: 'x' } });

  assert.ok(result.id);
  assert.strictEqual(client.folders.size, 1, 'only the root folder should be created');
});

test('Drive: mimeType falls back to blob.type then octet-stream', async () => {
  const client = createMockClient();
  const drive = new Drive({ client, appId: 'voice-notes' });

  await drive.upload({ name: 'a.bin', blob: { data: 'x' } });
  const uploadedFile = Array.from(client.files.values())[0];

  assert.strictEqual(uploadedFile.mimeType, 'application/octet-stream');
});
