import { GoogleAuth } from 'google-auth-library';

import { mergeAuthorizedDomains } from './voice-notes-e2e-config.mjs';

async function main() {
  const projectId = process.argv[2] || process.env.FIREBASE_PROJECT_ID;
  const domains = process.argv.slice(3);

  if (!projectId) {
    throw new Error('Usage: node scripts/update-firebase-auth-config.mjs <project-id> <domain> [domain...]');
  }
  if (domains.length === 0) {
    throw new Error('Provide at least one authorized domain to add');
  }

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/identitytoolkit'],
  });
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();
  const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;

  const currentResponse = await fetch(configUrl, { headers });
  if (!currentResponse.ok) {
    throw new Error(`Failed to read Firebase Auth config: ${currentResponse.status} ${await currentResponse.text()}`);
  }

  const currentConfig = await currentResponse.json();
  const authorizedDomains = mergeAuthorizedDomains(currentConfig.authorizedDomains, domains);

  if (
    Array.isArray(currentConfig.authorizedDomains) &&
    currentConfig.authorizedDomains.length === authorizedDomains.length &&
    currentConfig.authorizedDomains.every((domain, index) => domain === authorizedDomains[index])
  ) {
    console.log(`Firebase Auth authorized domains already contain: ${authorizedDomains.join(', ')}`);
    return;
  }

  const patchUrl = `${configUrl}?updateMask=authorizedDomains`;
  const patchResponse = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      ...headers,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: currentConfig.name || `projects/${projectId}/config`,
      authorizedDomains,
    }),
  });

  if (!patchResponse.ok) {
    throw new Error(`Failed to update Firebase Auth config: ${patchResponse.status} ${await patchResponse.text()}`);
  }

  console.log(`Updated Firebase Auth authorized domains: ${authorizedDomains.join(', ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
