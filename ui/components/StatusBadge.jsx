const COLORS = {
  sent: 'bg-accent/20 text-accent',
  replied: 'bg-good/20 text-good',
  followup_1: 'bg-warn/20 text-warn',
  followup_2: 'bg-warn/20 text-warn',
  sequence_complete: 'bg-border text-muted',
  apply_failed: 'bg-bad/20 text-bad',
  email_not_found: 'bg-bad/20 text-bad',
  ready_for_outreach: 'bg-good/20 text-good',
  pending_review: 'bg-warn/20 text-warn',
  outreach_sent: 'bg-accent/20 text-accent',
};

export default function StatusBadge({ status }) {
  const cls = COLORS[status] || 'bg-border text-muted';
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{status || 'unknown'}</span>
  );
}
