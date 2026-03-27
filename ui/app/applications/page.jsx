import Card from '@/components/Card';
import ApplicationsTable from './ApplicationsTable';
import { getRecentApplications } from '@/lib/db';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'sent', label: 'Sent' },
  { key: 'replied', label: 'Replied' },
  { key: 'followup_1', label: 'Follow-up 1' },
  { key: 'sequence_complete', label: 'Complete' },
  { key: 'apply_failed', label: 'Failed' },
];

const PAGE_SIZE = 50;

export default function ApplicationsPage({ searchParams }) {
  const status = searchParams?.status || '';
  const page = Math.max(0, parseInt(searchParams?.page || '0', 10) || 0);
  const rows = getRecentApplications(PAGE_SIZE, page * PAGE_SIZE, status || null);

  const qs = (o) => {
    const p = new URLSearchParams({ status, page: String(page), ...o });
    return `?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Applications</h1>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <a
            key={f.key}
            href={qs({ status: f.key, page: '0' })}
            className={`rounded-full px-3 py-1 text-sm ${
              status === f.key ? 'bg-accent/20 text-accent' : 'bg-surface text-muted hover:bg-border'
            }`}
          >
            {f.label}
          </a>
        ))}
      </div>

      <Card>
        <ApplicationsTable rows={rows} />
      </Card>

      <div className="flex justify-between text-sm">
        <a
          href={qs({ page: String(Math.max(0, page - 1)) })}
          className={`rounded px-3 py-1.5 ${page === 0 ? 'pointer-events-none text-border' : 'bg-surface text-text hover:bg-border'}`}
        >
          ← Prev
        </a>
        <span className="text-muted">Page {page + 1}</span>
        <a
          href={qs({ page: String(page + 1) })}
          className={`rounded px-3 py-1.5 ${rows.length < PAGE_SIZE ? 'pointer-events-none text-border' : 'bg-surface text-text hover:bg-border'}`}
        >
          Next →
        </a>
      </div>
    </div>
  );
}
