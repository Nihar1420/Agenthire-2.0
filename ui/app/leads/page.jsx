import Card from '@/components/Card';
import StatCard from '@/components/StatCard';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import AddPersonForm from './AddPersonForm';
import SendButton from './SendButton';
import { getLeads, safeQuery } from '@/lib/db';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

function pipelineHealth() {
  return safeQuery((db) => {
    const one = (sql) => db.prepare(sql).get()?.n ?? 0;
    return {
      total: one(`SELECT COUNT(*) n FROM leads`),
      ready: one(`SELECT COUNT(*) n FROM leads WHERE status='ready_for_outreach'`),
      sent: one(`SELECT COUNT(*) n FROM leads WHERE status='outreach_sent'`),
      noEmail: one(`SELECT COUNT(*) n FROM leads WHERE status IN ('no_email','email_not_found')`),
    };
  }, { total: 0, ready: 0, sent: 0, noEmail: 0 });
}

function perSource() {
  return safeQuery(
    (db) => db.prepare(`SELECT source, COUNT(*) n FROM leads GROUP BY source ORDER BY n DESC`).all(),
    []
  );
}

export default function LeadsPage({ searchParams }) {
  const source = searchParams?.source || '';
  const health = pipelineHealth();
  const sources = perSource();
  const leads = getLeads(100, source || null);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Leads &amp; Analytics</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total leads" value={health.total} />
        <StatCard label="Ready" value={health.ready} />
        <StatCard label="Outreach sent" value={health.sent} />
        <StatCard label="No email" value={health.noEmail} />
      </div>

      <Card title="Add a person manually">
        <AddPersonForm />
      </Card>

      <Card title="By source">
        {sources.length === 0 ? (
          <EmptyState message="No leads yet." />
        ) : (
          <div className="flex flex-wrap gap-2">
            <a href="/leads" className={`rounded-full px-3 py-1 text-sm ${!source ? 'bg-accent/20 text-accent' : 'bg-bg text-muted'}`}>
              All
            </a>
            {sources.map((s) => (
              <a
                key={s.source}
                href={`/leads?source=${encodeURIComponent(s.source)}`}
                className={`rounded-full px-3 py-1 text-sm ${source === s.source ? 'bg-accent/20 text-accent' : 'bg-bg text-muted'}`}
              >
                {s.source} ({s.n})
              </a>
            ))}
          </div>
        )}
      </Card>

      <Card title="Leads">
        {leads.length === 0 ? (
          <EmptyState />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-2">Company</th>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Age</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2">{l.company || '—'}</td>
                  <td>{l.name || '—'}</td>
                  <td className="text-muted">{l.email || '—'}</td>
                  <td>
                    <StatusBadge status={l.status} />
                  </td>
                  <td className="text-muted">{relativeTime(l.created_at)}</td>
                  <td>{l.email ? <SendButton contactId={l.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
