'use client';

import { useState } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { formatDate } from '@/lib/format';

export default function ApplicationsTable({ rows }) {
  const [openId, setOpenId] = useState(null);

  if (!rows.length) {
    return <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted">No applications.</div>;
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted">
        <tr>
          <th className="py-2">Sent</th>
          <th>Type</th>
          <th>Company</th>
          <th>To</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <>
            <tr
              key={a.id}
              onClick={() => setOpenId(openId === a.id ? null : a.id)}
              className="cursor-pointer border-t border-border hover:bg-surface"
            >
              <td className="py-2">{formatDate(a.sent_at)}</td>
              <td>{a.type}</td>
              <td>{a.company || '—'}</td>
              <td className="text-muted">{a.to_email || '—'}</td>
              <td>
                <StatusBadge status={a.status} />
              </td>
            </tr>
            {openId === a.id ? (
              <tr key={`${a.id}-body`} className="border-t border-border bg-bg">
                <td colSpan={5} className="p-4">
                  <div className="mb-2 font-semibold">{a.subject}</div>
                  <pre className="whitespace-pre-wrap text-xs text-muted">{a.body}</pre>
                </td>
              </tr>
            ) : null}
          </>
        ))}
      </tbody>
    </table>
  );
}
