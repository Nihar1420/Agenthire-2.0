import Card from '@/components/Card';
import StatCard from '@/components/StatCard';
import EmptyState from '@/components/EmptyState';
import {
  getDashboardStats,
  getBySourceCounts,
  getLatestCycle,
  getLogTail,
} from '@/lib/db';
import { relativeTime, formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Derive agent health from the most recent cycle_logs row. */
function agentStatus(cycle) {
  if (!cycle) return { label: 'No cycles yet', tone: 'text-muted' };
  const started = cycle.started_at ? Date.parse(`${cycle.started_at.replace(' ', 'T')}Z`) : 0;
  const ageH = started ? (Date.now() - started) / 3600000 : 999;
  if (cycle.status === 'running' && ageH > 1) return { label: 'Stalled', tone: 'text-bad' };
  if (cycle.status === 'running') return { label: 'Running', tone: 'text-good' };
  // Cron runs every 2h; a gap under ~2.5h between cycles is normal "idle".
  if (ageH > 3) return { label: 'Idle (overdue)', tone: 'text-warn' };
  return { label: 'Idle (healthy)', tone: 'text-good' };
}

export default function DashboardPage() {
  const stats = getDashboardStats();
  const bySource = getBySourceCounts();
  const cycle = getLatestCycle();
  const logs = getLogTail(10);
  const status = agentStatus(cycle);
  const maxSource = Math.max(1, ...bySource.map((s) => s.n));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <div className="flex gap-2 text-sm">
          <a href="/hirer-queue" className="rounded bg-accent/20 px-3 py-1.5 text-accent hover:bg-accent/30">
            Hirer Queue
          </a>
          <a href="/send" className="rounded bg-border px-3 py-1.5 text-text hover:bg-border/70">
            Manual Send
          </a>
        </div>
      </div>

      <Card title="Agent status">
        <div className="flex items-center justify-between">
          <span className={`text-lg font-semibold ${status.tone}`}>{status.label}</span>
          <span className="text-sm text-muted">
            {cycle ? `last cycle ${relativeTime(cycle.started_at)}` : 'never run'}
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Jobs" value={stats.jobs} />
        <StatCard label="Scored" value={stats.scored} />
        <StatCard label="Leads" value={stats.leads} />
        <StatCard label="Applications" value={stats.applications} />
        <StatCard label="Replies" value={stats.replies} />
        <StatCard label="Sent today" value={stats.sentToday} sub="cap 90" />
      </div>

      <Card title="Jobs by source">
        {bySource.length === 0 ? (
          <EmptyState message="No jobs scraped yet." />
        ) : (
          <div className="space-y-2">
            {bySource.map((s) => (
              <div key={s.source} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-muted">{s.source || 'unknown'}</span>
                <div className="h-3 flex-1 rounded bg-bg">
                  <div className="h-3 rounded bg-accent" style={{ width: `${(s.n / maxSource) * 100}%` }} />
                </div>
                <span className="w-10 text-right">{s.n}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Recent cycles">
        {logs.length === 0 ? (
          <EmptyState message="No cycle logs yet." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1">Started</th>
                <th>Status</th>
                <th>Jobs</th>
                <th>Leads</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-1">{formatDate(l.started_at)}</td>
                  <td>{l.status}</td>
                  <td>{l.jobs_found}</td>
                  <td>{l.leads_found}</td>
                  <td>{l.proposals_sent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
