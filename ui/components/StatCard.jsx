export default function StatCard({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-2xl font-semibold text-text">{value ?? 0}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-muted">{label}</div>
      {sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}
