// scripts/test-apollo.js — Apollo connectivity diagnostic.
// Checks whether the configured Apollo key + enabled flag can reach the API. Read-only.

import config from '../src/core/config.js';

async function main() {
  console.log('Apollo diagnostic');
  console.log('  APOLLO_ENABLED:', config.apolloEnabled);
  console.log('  APOLLO_API_KEY:', config.apolloApiKey ? 'present' : 'missing');

  if (!config.apolloEnabled) {
    console.log('\nApollo is disabled (APOLLO_ENABLED=false). The pipeline runs on fallbacks.');
    return;
  }
  if (!config.apolloApiKey) {
    console.log('\nAPOLLO_ENABLED=true but no APOLLO_API_KEY set — this will 401.');
    process.exit(1);
  }

  try {
    const res = await fetch('https://api.apollo.io/v1/auth/health', {
      headers: { 'X-Api-Key': config.apolloApiKey },
    });
    console.log(`\nHealth check: HTTP ${res.status} ${res.ok ? '(ok)' : '(check plan — free plans 403 the REST API)'}`);
  } catch (err) {
    console.error('Request failed:', err.message);
    process.exit(1);
  }
}

main();
