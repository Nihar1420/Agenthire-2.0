export default function EmptyState({ message = 'Nothing here yet.' }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted">
      {message}
    </div>
  );
}
