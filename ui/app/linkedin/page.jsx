import Card from '@/components/Card';
import StatCard from '@/components/StatCard';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import { safeQuery } from '@/lib/db';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function LinkedInPage() {
  const contacts = safeQuery(
    (db) => db.prepare(`SELECT * FROM contacts WHERE source_type='linkedin' ORDER BY created_at DESC LIMIT 100`).all(),
    []
  );
  const counts = safeQuery((db) => {
    const one = (t) => db.prepare(`SELECT COUNT(*) n FROM contacts WHERE track=?`).get(t)?.n ?? 0;
    return { recruiter: one('recruiter_job'), founder: one('founder_client') };
  }, { recruiter: 0, founder: 0 });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">LinkedIn Discovery</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Recruiter contacts" value={counts.recruiter} />
        <StatCard label="Founder / client" value={counts.founder} />
        <StatCard label="Total" value={contacts.length} />
      </div>
      <Card title="Discovered contacts">
        {contacts.length === 0 ? (
          <EmptyState message="No LinkedIn contacts discovered yet." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-2">Name</th>
                <th>Company</th>
                <th>Track</th>
                <th>Email</th>
                <th>Status</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-2">
                    {c.linkedin_url ? (
                      <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        {c.name || '—'}
                      </a>
                    ) : (
                      c.name || '—'
                    )}
                  </td>
                  <td>{c.company || '—'}</td>
                  <td className="text-muted">{c.track || '—'}</td>
                  <td className="text-muted">{c.email || '—'}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="text-muted">{relativeTime(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
