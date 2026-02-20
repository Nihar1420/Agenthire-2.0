// scripts/test-remoteok.js — inspect the RemoteOK tag vocabulary.
// Prints the most common tags across the live feed so keyword filters can be tuned.
// Read-only: no DB writes.

const API_URL = 'https://remoteok.com/api';

async function main() {
  const res = await fetch(API_URL, { headers: { 'User-Agent': 'AgentHireBot/1.0' } });
  if (!res.ok) throw new Error(`RemoteOK API HTTP ${res.status}`);
  const data = await res.json();
  const jobs = Array.isArray(data) ? data.slice(1) : [];

  const counts = new Map();
  for (const j of jobs) {
    for (const tag of j.tags || []) {
      const t = String(tag).toLowerCase();
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
  console.log(`RemoteOK: ${jobs.length} jobs, ${counts.size} distinct tags. Top 50:`);
  for (const [tag, n] of sorted) console.log(`  ${String(n).padStart(4)}  ${tag}`);
}

main().catch((e) => {
  console.error('test-remoteok failed:', e.message);
  process.exit(1);
});
