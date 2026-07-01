// drive.js: Google Drive API file I/O for blobs (audio, transcripts, large files).
// Organizes each app's files under a per-user, per-app folder so multiple
// voice-framework apps sharing a Google account don't collide.

const APP_ROOT_FOLDER = 'VoiceFramework';

export class Drive {
  constructor({ client, appId } = {}) {
    this.client = client; // injected Drive REST client (fetch-like, or gapi.client.drive)
    this.appId = appId;
    this._folderCache = new Map();
  }

  async _findOrCreateFolder(name, parentId = null) {
    const cacheKey = `${parentId ?? 'root'}/${name}`;
    if (this._folderCache.has(cacheKey)) {
      return this._folderCache.get(cacheKey);
    }

    const existing = await this.client.findFolder({ name, parentId });
    if (existing) {
      this._folderCache.set(cacheKey, existing.id);
      return existing.id;
    }

    const created = await this.client.createFolder({ name, parentId });
    this._folderCache.set(cacheKey, created.id);
    return created.id;
  }

  async _appFolderId() {
    const rootId = await this._findOrCreateFolder(APP_ROOT_FOLDER);
    if (!this.appId) return rootId;
    return this._findOrCreateFolder(this.appId, rootId);
  }

  // Upload a file (Blob-like: { data, mimeType }) with the given title into
  // this app's Drive folder. Returns { id, name, webViewLink? }.
  async upload({ name, blob, mimeType }) {
    if (!name) throw new Error('upload() requires a name');
    if (!blob) throw new Error('upload() requires a blob');

    const folderId = await this._appFolderId();
    return this.client.uploadFile({
      name,
      mimeType: mimeType || blob.type || 'application/octet-stream',
      data: blob,
      parentId: folderId,
    });
  }

  async download(fileId) {
    if (!fileId) throw new Error('download() requires a fileId');
    return this.client.downloadFile(fileId);
  }

  async list() {
    const folderId = await this._appFolderId();
    return this.client.listFiles({ parentId: folderId });
  }

  async delete(fileId) {
    if (!fileId) throw new Error('delete() requires a fileId');
    return this.client.deleteFile(fileId);
  }
}

export async function createDrive(config) {
  return new Drive(config);
}
