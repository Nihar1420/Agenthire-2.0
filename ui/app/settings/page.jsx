import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Card from '@/components/Card';
import { getLatestCycle } from '@/lib/db';
import { formatDate, relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Report only PRESENCE of secrets (never values).
const KEYS = [
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'RESEND_API_KEY',
  'SENDING_DOMAIN',
  'IMAP_USER',
  'IMAP_PASS',
  'HUNTER_API_KEY',
  'SNOV_CLIENT_ID',
  'SNOV_CLIENT_SECRET',
  'PROSPEO_API_KEY',
  'APOLLO_API_KEY',
  'GOOGLE_PLACES_API_KEY',
  'APIFY_API_TOKEN',
  'FCM_DEVICE_TOKEN',
];

function loadSkills() {
  try {
    const p = join(process.cwd(), '..', 'config', 'skills.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    /* ignore */
  }
  return null;
}

export default function SettingsPage() {
  const cycle = getLatestCycle();
  const uptime = Math.floor(process.uptime());
  const skills = loadSkills();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card title="Runtime">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Dashboard uptime</dt>
          <dd>{uptime}s</dd>
          <dt className="text-muted">Last cycle</dt>
          <dd>{cycle ? `${formatDate(cycle.started_at)} (${relativeTime(cycle.started_at)})` : 'never'}</dd>
          <dt className="text-muted">Last cycle status</dt>
          <dd>{cycle?.status || '—'}</dd>
        </dl>
      </Card>

      <Card title="Environment keys (presence only)">
        <div className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
          {KEYS.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className={process.env[k] ? 'text-good' : 'text-border'}>{process.env[k] ? '●' : '○'}</span>
              <span className="text-muted">{k}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="skills.json">
        <pre className="whitespace-pre-wrap text-xs text-muted">
          {skills ? JSON.stringify(skills, null, 2) : 'skills.json not found'}
        </pre>
      </Card>
    </div>
  );
}
