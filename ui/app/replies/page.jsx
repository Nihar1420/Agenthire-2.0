import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import { getReplies } from '@/lib/db';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default function RepliesPage() {
  const replies = getReplies(100);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Replies</h1>
      <Card>
        {replies.length === 0 ? (
          <EmptyState message="No replies yet." />
        ) : (
          <ul className="divide-y divide-border">
            {replies.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.company || r.to_email || 'Unknown'}</span>
                  <span className="text-xs text-muted">{formatDate(r.created_at)}</span>
                </div>
                <div className="mt-1 text-sm text-muted">{r.detail}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
