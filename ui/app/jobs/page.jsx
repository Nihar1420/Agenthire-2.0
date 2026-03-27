import Card from '@/components/Card';
import StatCard from '@/components/StatCard';
import EmptyState from '@/components/EmptyState';
import { safeQuery } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function JobsPage() {
  // Email-apply performance by source (the platform of the job applied to).
  const bySource = safeQuery(
    (db) =>
      db
        .prepare(
          `SELECT j.platform AS source, COUNT(*) n
           FROM applications a JOIN jobs j ON j.id = a.job_id
           WHERE a.type = 'email_apply' GROUP BY j.platform ORDER BY n DESC`
        )
        .all(),
    []
  );
  const sent = safeQuery(
    (db) =>
      db
        .prepare(`SELECT * FROM applications WHERE type='email_apply' ORDER BY sent_at DESC LIMIT 100`)
        .all(),
    []
  );
  const total = sent.length;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Email-Apply Jobs</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Email applies" value={total} />
        {bySource.slice(0, 3).map((s) => (
          <StatCard key={s.source} label={s.source || 'unknown'} value={s.n} />
        ))}
      </div>
      <Card title="Sent email applications">
        {sent.length === 0 ? (
          <EmptyState message="No email applications sent yet." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-2">Sent</th>
                <th>Company</th>
                <th>To</th>
                <th>Subject</th>
              </tr>
            </thead>
            <tbody>
              {sent.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="py-2">{formatDate(a.sent_at)}</td>
                  <td>{a.company || '—'}</td>
                  <td className="text-muted">{a.to_email}</td>
                  <td>{a.subject}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
