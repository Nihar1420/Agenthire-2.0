import Card from '@/components/Card';
import StatusBadge from '@/components/StatusBadge';
import EmptyState from '@/components/EmptyState';
import HirerQueueClient from './HirerQueueClient';
import PasteEmail from './PasteEmail';
import { getHirerQueue, safeQuery } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default function HirerQueuePage() {
  const jobs = getHirerQueue(100);
  const pending = safeQuery(
    (db) => db.prepare(`SELECT * FROM contacts WHERE status='pending_review' ORDER BY created_at DESC LIMIT 100`).all(),
    []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Hirer Queue</h1>
        <HirerQueueClient />
      </div>

      <Card title="Contacts pending review">
        {pending.length === 0 ? (
          <EmptyState message="No contacts pending review. Run “Find contacts”." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-2">Name</th>
                <th>Company</th>
                <th>Email</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-2">{c.name || '—'}</td>
                  <td>{c.company || '—'}</td>
                  <td className="text-muted">{c.email || '—'}</td>
                  <td>
                    <PasteEmail contactId={c.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Jobs needing a contact">
        {jobs.length === 0 ? (
          <EmptyState message="No jobs need a contact lookup." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-2">Title</th>
                <th>Company</th>
                <th>Score</th>
                <th>Lookup</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-border">
                  <td className="py-2">{j.title}</td>
                  <td>{j.company || '—'}</td>
                  <td>{j.score ?? '—'}</td>
                  <td>
                    <StatusBadge status={j.contact_lookup_status || 'pending'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
