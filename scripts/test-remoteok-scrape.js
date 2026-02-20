// scripts/test-remoteok-scrape.js — dry-run the RemoteOK keyword filter against the live
// feed WITHOUT writing to the DB. Shows what would pass/fail so filters can be validated.

import { matchKeywords } from '../src/utils/keyword-match.js';

const API_URL = 'https://remoteok.com/api';

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function main() {
  const res = await fetch(API_URL, { headers: { 'User-Agent': 'AgentHireBot/1.0' } });
  if (!res.ok) throw new Error(`RemoteOK API HTTP ${res.status}`);
  const data = await res.json();
  const jobs = Array.isArray(data) ? data.slice(1) : [];

  let pass = 0;
  const samples = [];
  for (const j of jobs) {
    const title = j.position || j.title || '';
    const description = stripHtml(j.description || '');
    const tags = Array.isArray(j.tags) ? j.tags : [];
    const ok = matchKeywords(`${title} ${description}`, tags);
    if (ok) {
      pass += 1;
      if (samples.length < 15) samples.push(`✓ ${j.company || '?'} — ${title}`);
    }
  }

  console.log(`RemoteOK dry-run: ${pass}/${jobs.length} jobs pass the keyword filter.`);
  console.log('Sample matches:');
  for (const s of samples) console.log('  ' + s);
  console.log('(No rows were written to the database.)');
}

main().catch((e) => {
  console.error('test-remoteok-scrape failed:', e.message);
  process.exit(1);
});
