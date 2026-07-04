const E2E_SITE_SUFFIX = '-e2e';
const MAX_SITE_ID_LENGTH = 30;
const VOICE_NOTES_PATH = '/examples/voice-notes/index.html';

export function resolveVoiceNotesE2ESiteId(projectId) {
  if (!projectId) {
    throw new Error('resolveVoiceNotesE2ESiteId() requires a Firebase project id');
  }

  const trimmedBase = projectId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SITE_ID_LENGTH - E2E_SITE_SUFFIX.length)
    .replace(/-+$/g, '');

  if (!trimmedBase) {
    throw new Error(`Unable to derive a stable Hosting site id from project id: ${projectId}`);
  }

  return `${trimmedBase}${E2E_SITE_SUFFIX}`;
}

export function resolveVoiceNotesE2EUrl({ projectId, url } = {}) {
  if (url) {
    return url;
  }

  const siteId = resolveVoiceNotesE2ESiteId(projectId);
  return `https://${siteId}.web.app${VOICE_NOTES_PATH}`;
}

export function mergeAuthorizedDomains(existingDomains = [], extraDomains = []) {
  const merged = new Set(
    [...existingDomains, ...extraDomains]
      .map((domain) => String(domain || '').trim().toLowerCase())
      .filter(Boolean)
  );
  return [...merged].sort();
}
